import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createInventoryService, TRANSFER_REASONS } from '../domain/inventory/inventory-service.js';
import { SESSION_COOKIE } from '../plugins/auth-plugin.js';
import {
  buildTestApp,
  createTestPrisma,
  registerTestUser,
  TEST_ORIGIN,
  truncateAll,
} from '../test-helpers.js';

let prisma: PrismaClient;
let app: FastifyInstance;
const inventoryOf = () => createInventoryService(prisma);

beforeAll(async () => {
  prisma = createTestPrisma();
  app = await buildTestApp(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

type Auth = { cookie: string; csrf: string };

async function setupTrader(input: { region: string; locationSlug?: string; gold?: bigint }) {
  const auth = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Trader ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'wayfarer' },
  });
  expect(created.statusCode).toBe(201);
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  const location = await prisma.location.findUniqueOrThrow({
    where: { slug: input.locationSlug ?? 'crownfall-market-district' },
  });
  await prisma.character.update({
    where: { id: character.id },
    data: { currentLocationId: location.id },
  });
  await prisma.currencyAccount.update({
    where: { characterId: character.id },
    data: { balance: input.gold ?? 10_000n },
  });
  const shop = await app.inject({
    method: 'POST',
    url: '/api/v1/player-shops',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Stall ${Math.random().toString(36).slice(2, 8)}`, region: input.region },
  });
  expect(shop.statusCode).toBe(201);
  return { auth, characterId: character.id };
}

async function grantStack(characterId: string, slug: string, quantity: number) {
  const def = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug } });
  await prisma.$transaction((tx) =>
    inventoryOf().addToStack(tx, {
      characterId,
      itemDefinitionId: def.id,
      quantity,
      reason: TRANSFER_REASONS.TEST_GRANT,
    }),
  );
  return def;
}

async function grantInstance(characterId: string, slug: string) {
  const def = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug } });
  return prisma.$transaction((tx) =>
    inventoryOf().grantInstance(tx, {
      characterId,
      itemDefinitionId: def.id,
      reason: TRANSFER_REASONS.TEST_GRANT,
    }),
  );
}

function post(auth: Auth, url: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: payload as object,
  });
}

function get(auth: { cookie: string }, url: string) {
  return app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE]: auth.cookie } });
}

function del(auth: Auth, url: string) {
  return app.inject({
    method: 'DELETE',
    url,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

async function listStack(auth: Auth, slug: string, quantity: number, price: string, key: string) {
  const response = await post(auth, '/api/v1/marketplace/listings', {
    itemSlug: slug,
    quantity,
    price,
    idempotencyKey: key,
  });
  expect(response.statusCode).toBe(201);
  return response.json().listingId as string;
}

describe('player shops', () => {
  it('creates one shop per character, region-validated, and updates it', async () => {
    const { auth } = await setupTrader({ region: 'crownfall' });
    const second = await post(auth, '/api/v1/player-shops', {
      name: 'Second Stall',
      region: 'crownfall',
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('SHOP_EXISTS');

    const other = await registerTestUser(app);
    await post(other, '/api/v1/characters', { name: 'Regionless', classSlug: 'vanguard' });
    const bad = await post(other, '/api/v1/player-shops', {
      name: 'Nowhere Stall',
      region: 'atlantis',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('UNKNOWN_REGION');

    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/v1/player-shops/me',
      headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
      cookies: { [SESSION_COOKIE]: auth.cookie },
      payload: { description: 'Finest wares in the district.' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().description).toBe('Finest wares in the district.');
  });
});

describe('listings', () => {
  it('creates a stack listing: goods held, fee charged, reservation created', async () => {
    const seller = await setupTrader({ region: 'crownfall' });
    await grantStack(seller.characterId, 'copper-ore', 20);

    const listingId = await listStack(seller.auth, 'copper-ore', 15, '300', 'list-0001');

    // Goods left active inventory.
    const stack = await prisma.inventoryStack.findFirst({
      where: { characterId: seller.characterId, itemDefinition: { slug: 'copper-ore' } },
    });
    expect(stack?.quantity).toBe(5);

    // Fee: floor(300 * 200 / 10000) = 6, ledger-recorded.
    const fee = await prisma.currencyTransaction.findFirst({ where: { type: 'LISTING_FEE' } });
    expect(fee?.amount).toBe(-6n);

    // Return reservation holds a slot.
    const listing = await prisma.marketplaceListing.findUniqueOrThrow({
      where: { id: listingId },
    });
    const reservation = await prisma.inventoryCapacityReservation.findUniqueOrThrow({
      where: { id: listing.returnReservationId! },
    });
    expect(reservation.releasedAt).toBeNull();

    // Idempotent replay returns the same listing.
    const replay = await post(seller.auth, '/api/v1/marketplace/listings', {
      itemSlug: 'copper-ore',
      quantity: 15,
      price: '300',
      idempotencyKey: 'list-0001',
    });
    expect(replay.json().listingId).toBe(listingId);
    expect(await prisma.marketplaceListing.count()).toBe(1);
  });

  it('locks listed instances and rejects equipped/locked/foreign assets', async () => {
    const seller = await setupTrader({ region: 'crownfall' });
    const blade = await grantInstance(seller.characterId, 'pinewood-buckler');
    const created = await post(seller.auth, '/api/v1/marketplace/listings', {
      itemInstanceId: blade.id,
      price: '80',
      idempotencyKey: 'list-0002',
    });
    expect(created.statusCode).toBe(201);
    const locked = await prisma.itemInstance.findUniqueOrThrow({ where: { id: blade.id } });
    expect(locked.lockState).toBe('LISTED');

    // A listed instance cannot be listed again or equipped.
    const again = await post(seller.auth, '/api/v1/marketplace/listings', {
      itemInstanceId: blade.id,
      price: '90',
      idempotencyKey: 'list-0003',
    });
    expect(again.statusCode).toBe(409);
    const equip = await post(seller.auth, '/api/v1/equipment/equip', {
      itemInstanceId: blade.id,
    });
    expect(equip.statusCode).toBe(409);
  });

  it('validates price bounds and marketplace location', async () => {
    const seller = await setupTrader({ region: 'crownfall' });
    await grantStack(seller.characterId, 'copper-ore', 5);

    const low = await post(seller.auth, '/api/v1/marketplace/listings', {
      itemSlug: 'copper-ore',
      quantity: 1,
      price: '0',
      idempotencyKey: 'list-0004',
    });
    expect(low.statusCode).toBe(400);

    const high = await post(seller.auth, '/api/v1/marketplace/listings', {
      itemSlug: 'copper-ore',
      quantity: 1,
      price: '1000000001',
      idempotencyKey: 'list-0005',
    });
    expect(high.statusCode).toBe(400);
    expect(high.json().error.code).toBe('PRICE_TOO_HIGH');

    const city = await prisma.location.findUniqueOrThrow({ where: { slug: 'crownfall-city' } });
    await prisma.character.update({
      where: { id: seller.characterId },
      data: { currentLocationId: city.id },
    });
    const wrongPlace = await post(seller.auth, '/api/v1/marketplace/listings', {
      itemSlug: 'copper-ore',
      quantity: 1,
      price: '10',
      idempotencyKey: 'list-0006',
    });
    expect(wrongPlace.statusCode).toBe(409);
    expect(wrongPlace.json().error.code).toBe('NO_MARKETPLACE_HERE');
  });

  it('cancels a listing: goods and reservation return', async () => {
    const seller = await setupTrader({ region: 'crownfall' });
    await grantStack(seller.characterId, 'iron-ore', 10);
    const listingId = await listStack(seller.auth, 'iron-ore', 10, '100', 'list-0007');

    const cancel = await del(seller.auth, `/api/v1/marketplace/listings/${listingId}`);
    expect(cancel.statusCode).toBe(200);
    const stack = await prisma.inventoryStack.findFirst({
      where: { characterId: seller.characterId, itemDefinition: { slug: 'iron-ore' } },
    });
    expect(stack?.quantity).toBe(10);
    const listing = await prisma.marketplaceListing.findUniqueOrThrow({
      where: { id: listingId },
    });
    expect(listing.status).toBe('CANCELED');
    const reservation = await prisma.inventoryCapacityReservation.findUniqueOrThrow({
      where: { id: listing.returnReservationId! },
    });
    expect(reservation.releasedAt).not.toBeNull();

    // Only the seller can cancel.
    const other = await setupTrader({ region: 'crownfall' });
    await grantStack(other.characterId, 'iron-ore', 5);
    const otherListing = await listStack(other.auth, 'iron-ore', 5, '50', 'list-0008');
    const foreign = await del(seller.auth, `/api/v1/marketplace/listings/${otherListing}`);
    expect(foreign.statusCode).toBe(403);
  });

  it('expired listings vanish immediately and finalize exactly once', async () => {
    const seller = await setupTrader({ region: 'crownfall' });
    await grantStack(seller.characterId, 'copper-ore', 10);
    const listingId = await listStack(seller.auth, 'copper-ore', 10, '100', 'list-0009');
    await prisma.marketplaceListing.update({
      where: { id: listingId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // Unavailable to buyers immediately, even before any cleanup.
    const buyer = await setupTrader({ region: 'crownfall' });
    const buyAttempt = await post(
      buyer.auth,
      `/api/v1/marketplace/listings/${listingId}/purchase`,
      { idempotencyKey: 'buy-0001' },
    );
    expect(buyAttempt.statusCode).toBe(409);
    expect(buyAttempt.json().error.code).toBe('LISTING_UNAVAILABLE');

    // Concurrent browsing finalizes the return exactly once.
    await Promise.all([
      get(buyer.auth, '/api/v1/marketplace/listings'),
      get(buyer.auth, '/api/v1/marketplace/listings'),
      get(buyer.auth, '/api/v1/marketplace/listings'),
    ]);
    const listing = await prisma.marketplaceListing.findUniqueOrThrow({
      where: { id: listingId },
    });
    expect(listing.status).toBe('EXPIRED');
    const stack = await prisma.inventoryStack.findFirst({
      where: { characterId: seller.characterId, itemDefinition: { slug: 'copper-ore' } },
    });
    expect(stack?.quantity).toBe(10); // returned once, not thrice
  });
});

describe('purchases', () => {
  it('local whole-listing purchase: immediate delivery, tax rounding, atomic money movement', async () => {
    const seller = await setupTrader({ region: 'crownfall', gold: 1_000n });
    await grantStack(seller.characterId, 'copper-ore', 10);
    const listingId = await listStack(seller.auth, 'copper-ore', 10, '999', 'list-0010');
    const sellerGoldAfterFee = 1_000n - 19n; // fee floor(999*200/10000)=19

    const buyer = await setupTrader({ region: 'crownfall', gold: 2_000n });
    const purchase = await post(buyer.auth, `/api/v1/marketplace/listings/${listingId}/purchase`, {
      idempotencyKey: 'buy-0002',
    });
    expect(purchase.statusCode).toBe(200);
    const body = purchase.json();
    expect(body.remote).toBe(false);
    expect(body.shippingFee).toBe('0');
    expect(body.totalCharged).toBe('999');
    expect(body.gold).toBe('1001'); // 2000 - 999

    // Tax: floor(999 * 500 / 10000) = 49; proceeds 950.
    const sale = await prisma.marketplaceSale.findUniqueOrThrow({ where: { listingId } });
    expect(sale.tax).toBe(49n);
    expect(sale.sellerProceeds).toBe(950n);
    const sellerAccount = await prisma.currencyAccount.findUniqueOrThrow({
      where: { characterId: seller.characterId },
    });
    expect(sellerAccount.balance).toBe(sellerGoldAfterFee + 950n);

    // Buyer received the goods immediately.
    const stack = await prisma.inventoryStack.findFirst({
      where: { characterId: buyer.characterId, itemDefinition: { slug: 'copper-ore' } },
    });
    expect(stack?.quantity).toBe(10);

    // Duplicate idempotency replays without extra effects.
    const replay = await post(buyer.auth, `/api/v1/marketplace/listings/${listingId}/purchase`, {
      idempotencyKey: 'buy-0002',
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().saleId).toBe(body.saleId);
    expect(await prisma.marketplaceSale.count()).toBe(1);
  });

  it('remote purchase: shipping, transit lock, reserved capacity, exactly-once arrival', async () => {
    // Seller's shop registered to a different region than the marketplace.
    const seller = await setupTrader({ region: 'deepvale' });
    const buckler = await grantInstance(seller.characterId, 'pinewood-buckler');
    const created = await post(seller.auth, '/api/v1/marketplace/listings', {
      itemInstanceId: buckler.id,
      price: '100',
      idempotencyKey: 'list-0011',
    });
    expect(created.statusCode).toBe(201);
    const listingId = created.json().listingId as string;

    const buyer = await setupTrader({ region: 'crownfall', gold: 500n });
    const purchase = await post(buyer.auth, `/api/v1/marketplace/listings/${listingId}/purchase`, {
      idempotencyKey: 'buy-0003',
    });
    expect(purchase.statusCode).toBe(200);
    const body = purchase.json();
    expect(body.remote).toBe(true);
    expect(body.shippingFee).toBe('10');
    expect(body.totalCharged).toBe('110');
    expect(body.deliveryArrivesAt).not.toBeNull();

    // Ownership transferred immediately, but transit-locked.
    const instance = await prisma.itemInstance.findUniqueOrThrow({ where: { id: buckler.id } });
    expect(instance.ownerCharacterId).toBe(buyer.characterId);
    expect(instance.lockState).toBe('IN_TRANSIT');
    // The buyer cannot equip an in-transit item.
    const equip = await post(buyer.auth, '/api/v1/equipment/equip', {
      itemInstanceId: buckler.id,
    });
    expect(equip.statusCode).toBe(409);

    // Capacity reservation holds the destination slot.
    const delivery = await prisma.delivery.findFirstOrThrow({
      where: { buyerCharacterId: buyer.characterId },
    });
    const reservation = await prisma.inventoryCapacityReservation.findUniqueOrThrow({
      where: { id: delivery.capacityReservationId },
    });
    expect(reservation.releasedAt).toBeNull();

    // Arrival: lazy finalization on /deliveries, exactly once under races.
    await prisma.delivery.update({
      where: { id: delivery.id },
      data: { arrivesAt: new Date(Date.now() - 1000) },
    });
    const [first, second] = await Promise.all([
      get(buyer.auth, '/api/v1/deliveries'),
      get(buyer.auth, '/api/v1/deliveries'),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const arrived = await prisma.itemInstance.findUniqueOrThrow({ where: { id: buckler.id } });
    expect(arrived.lockState).toBe('NONE');
    const releasedReservation = await prisma.inventoryCapacityReservation.findUniqueOrThrow({
      where: { id: delivery.capacityReservationId },
    });
    expect(releasedReservation.releasedAt).not.toBeNull();
    const finalDelivery = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(finalDelivery.status).toBe('DELIVERED');
  });

  it('rejects remote purchase when destination capacity cannot be reserved', async () => {
    const seller = await setupTrader({ region: 'deepvale' });
    await grantStack(seller.characterId, 'iron-ore', 5);
    const listingId = await listStack(seller.auth, 'iron-ore', 5, '50', 'list-0012');

    const buyer = await setupTrader({ region: 'crownfall' });
    await prisma.inventoryCapacityReservation.create({
      data: { characterId: buyer.characterId, slots: 22, reason: 'TEST_FILL' },
    });
    const purchase = await post(buyer.auth, `/api/v1/marketplace/listings/${listingId}/purchase`, {
      idempotencyKey: 'buy-0004',
    });
    expect(purchase.statusCode).toBe(409);
    expect(purchase.json().error.code).toBe('INVENTORY_FULL');
    // Nothing moved: listing still active, buyer not charged.
    const listing = await prisma.marketplaceListing.findUniqueOrThrow({
      where: { id: listingId },
    });
    expect(listing.status).toBe('ACTIVE');
    const account = await prisma.currencyAccount.findUniqueOrThrow({
      where: { characterId: buyer.characterId },
    });
    expect(account.balance).toBe(10_000n);
  });

  it('exactly one of two concurrent buyers wins the listing', async () => {
    const seller = await setupTrader({ region: 'crownfall' });
    await grantStack(seller.characterId, 'copper-ore', 10);
    const listingId = await listStack(seller.auth, 'copper-ore', 10, '100', 'list-0013');

    const buyerA = await setupTrader({ region: 'crownfall' });
    const buyerB = await setupTrader({ region: 'crownfall' });
    const [a, b] = await Promise.all([
      post(buyerA.auth, `/api/v1/marketplace/listings/${listingId}/purchase`, {
        idempotencyKey: 'race-000a',
      }),
      post(buyerB.auth, `/api/v1/marketplace/listings/${listingId}/purchase`, {
        idempotencyKey: 'race-000b',
      }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.marketplaceSale.count()).toBe(1);
    // Seller was credited exactly once.
    expect(await prisma.currencyTransaction.count({ where: { type: 'MARKET_PROCEEDS' } })).toBe(1);
  });

  it('rejects self-purchase, unsafe browsing, and purchases away from a marketplace', async () => {
    const seller = await setupTrader({ region: 'crownfall' });
    await grantStack(seller.characterId, 'copper-ore', 5);
    const listingId = await listStack(seller.auth, 'copper-ore', 5, '10', 'list-0014');

    const self = await post(seller.auth, `/api/v1/marketplace/listings/${listingId}/purchase`, {
      idempotencyKey: 'buy-0005',
    });
    expect(self.statusCode).toBe(400);
    expect(self.json().error.code).toBe('SELF_PURCHASE');

    const buyer = await setupTrader({ region: 'crownfall' });
    // Browsing from an unsafe location is rejected; safe non-marketplace is fine.
    const mine = await prisma.location.findUniqueOrThrow({ where: { slug: 'ironroot-mine' } });
    await prisma.character.update({
      where: { id: buyer.characterId },
      data: { currentLocationId: mine.id },
    });
    const unsafe = await get(buyer.auth, '/api/v1/marketplace/listings');
    expect(unsafe.statusCode).toBe(409);
    expect(unsafe.json().error.code).toBe('UNSAFE_LOCATION');

    const city = await prisma.location.findUniqueOrThrow({ where: { slug: 'crownfall-city' } });
    await prisma.character.update({
      where: { id: buyer.characterId },
      data: { currentLocationId: city.id },
    });
    expect((await get(buyer.auth, '/api/v1/marketplace/listings')).statusCode).toBe(200);
    const wrongPlace = await post(
      buyer.auth,
      `/api/v1/marketplace/listings/${listingId}/purchase`,
      { idempotencyKey: 'buy-0006' },
    );
    expect(wrongPlace.statusCode).toBe(409);
    expect(wrongPlace.json().error.code).toBe('NO_MARKETPLACE_HERE');
  });
});

describe('market summary', () => {
  it('reports insufficient history below five sales, then median and volume', async () => {
    const seller = await setupTrader({ region: 'crownfall' });
    await grantStack(seller.characterId, 'copper-ore', 60);
    const buyer = await setupTrader({ region: 'crownfall', gold: 100_000n });

    let summary = (await get(buyer.auth, '/api/v1/marketplace/items/copper-ore/summary')).json();
    expect(summary.insufficientHistory).toBe(true);
    expect(summary.medianUnitPrice).toBeNull();

    // Five sales at 10 gold per unit (10 units each → 100 gross).
    for (let i = 0; i < 5; i++) {
      const listingId = await listStack(seller.auth, 'copper-ore', 10, '100', `list-sum-${i}`);
      const bought = await post(buyer.auth, `/api/v1/marketplace/listings/${listingId}/purchase`, {
        idempotencyKey: `buy-sum-${i}`,
      });
      expect(bought.statusCode).toBe(200);
      // Free the buyer's stack slot pressure by keeping quantities merged.
    }

    summary = (await get(buyer.auth, '/api/v1/marketplace/items/copper-ore/summary')).json();
    expect(summary.insufficientHistory).toBe(false);
    expect(summary.recentSales).toBe(5);
    expect(summary.medianUnitPrice).toBe('10');
    expect(summary.volume).toBe(50);
  });
});
