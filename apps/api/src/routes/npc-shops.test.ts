import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

/** Registers a character standing in the Market District with rich pockets. */
async function setupShopper(gold = 100_000n) {
  const auth = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Buyer ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'vanguard' },
  });
  expect(created.statusCode).toBe(201);
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  const market = await prisma.location.findUniqueOrThrow({
    where: { slug: 'crownfall-market-district' },
  });
  await prisma.character.update({
    where: { id: character.id },
    data: { currentLocationId: market.id },
  });
  await prisma.currencyAccount.update({
    where: { characterId: character.id },
    data: { balance: gold },
  });
  return { auth, characterId: character.id };
}

async function generalGoods() {
  return prisma.npcShop.findUniqueOrThrow({ where: { slug: 'crownfall-general-goods' } });
}

function getShop(auth: { cookie: string }, shopId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/npc-shops/${shopId}`,
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

function buy(
  auth: { cookie: string; csrf: string },
  shopId: string,
  payload: { stockEntryId: string; quantity: number; idempotencyKey: string },
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/npc-shops/${shopId}/purchases`,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload,
  });
}

describe('shop configuration', () => {
  it('seeds two Market District shops with randomized delays, weighted pools, and resale spreads', async () => {
    const shops = await prisma.npcShop.findMany({ include: { location: true } });
    expect(shops.map((s) => s.slug).sort()).toEqual(['crownfall-forge', 'crownfall-general-goods']);
    for (const shop of shops) {
      expect(shop.location.slug).toBe('crownfall-market-district');
      expect(shop.restockJitterSeconds).toBeGreaterThan(0);
      const config = shop.poolConfig as { restockSlots: number; pool: Array<{ weight: number }> };
      expect(config.restockSlots).toBeGreaterThan(0);
      expect(config.pool.length).toBeGreaterThanOrEqual(config.restockSlots);
      expect(new Set(config.pool.map((p) => p.weight)).size).toBeGreaterThan(1); // weighted
      // Guaranteed buy/sell loops are impossible: sellback strictly below markup.
      expect(shop.sellbackBps).toBeLessThan(shop.markupBps);
      expect(shop.sellbackBps).toBeLessThan(10_000);
    }
  });

  it('defines regional price modifiers before purchase logic', async () => {
    const modifiers = await prisma.regionalPriceModifier.findMany({
      include: { location: true },
    });
    const bySlug = (slug: string, category: string) =>
      modifiers.find((m) => m.location.slug === slug && m.category === category)?.modifierBps;
    expect(bySlug('crownfall-market-district', 'CONSUMABLE')).toBe(10500);
    expect(bySlug('ironroot-mine', 'RESOURCE')).toBe(7500); // cheaper ore
    expect(bySlug('ironroot-mine', 'CONSUMABLE')).toBe(13000); // costlier food
    expect(bySlug('greenmeadow-village', 'CONSUMABLE')).toBe(8000);
    expect(bySlug('greenmeadow-village', 'EQUIPMENT')).toBe(13000);
    expect(bySlug('silvermere-lake', 'RESOURCE')).toBe(8500);
    expect(bySlug('crownfall-harbor', 'SPECIALTY')).toBe(9000);
  });
});

describe('restocking', () => {
  it('restocks lazily from the weighted pool with quantities and prices in range', async () => {
    const { auth } = await setupShopper();
    const shop = await generalGoods();
    const response = await getShop(auth, shop.id);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.stock.length).toBe(5); // restockSlots

    const config = shop.poolConfig as {
      pool: Array<{ itemSlug: string; minQuantity: number; maxQuantity: number }>;
    };
    for (const entry of await prisma.npcShopStockEntry.findMany({
      // Scope to the shop under test: other suites may restock other shops
      // concurrently against the shared database, and their prices use a
      // different location modifier than this shop's Market District 10500.
      where: { restock: { shopId: shop.id } },
      include: { itemDefinition: true },
    })) {
      const poolEntry = config.pool.find((p) => p.itemSlug === entry.itemDefinition.slug);
      expect(poolEntry).toBeDefined();
      expect(entry.quantityTotal).toBeGreaterThanOrEqual(poolEntry!.minQuantity);
      expect(entry.quantityTotal).toBeLessThanOrEqual(poolEntry!.maxQuantity);
      // Price: base × the item category's regional modifier (default 10000) ×
      // the shop markup, each applied as floored basis points — exactly as the
      // service computes it. The pool spans categories with different modifiers,
      // so the expected value must use each item's own category modifier.
      const modifier = await prisma.regionalPriceModifier.findUnique({
        where: {
          locationId_category: {
            locationId: shop.locationId,
            category: entry.itemDefinition.category,
          },
        },
      });
      const modifierBps = BigInt(modifier?.modifierBps ?? 10_000);
      const regional = (entry.itemDefinition.baseValue * modifierBps) / 10_000n;
      const expected = (regional * BigInt(shop.markupBps)) / 10_000n;
      expect(entry.unitPrice).toBe(expected > 0n ? expected : 1n);
    }

    // Exact restock timestamps never leave the API.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('nextRestockAt');
    expect(raw).not.toContain('restockedAt');
    expect(raw).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); // no ISO timestamps at all
  });

  it('performs at most one catch-up restock after downtime', async () => {
    const { auth } = await setupShopper();
    const shop = await generalGoods();
    // Simulate several missed intervals.
    await prisma.npcShop.update({
      where: { id: shop.id },
      data: { nextRestockAt: new Date(Date.now() - 5 * 3600 * 1000) },
    });
    await getShop(auth, shop.id);
    expect(await prisma.npcShopRestock.count({ where: { shopId: shop.id } })).toBe(1);

    const fresh = await prisma.npcShop.findUniqueOrThrow({ where: { id: shop.id } });
    // Next restock is scheduled from now (interval 1800s + jitter ≤ 600s).
    const secondsOut = (fresh.nextRestockAt.getTime() - Date.now()) / 1000;
    expect(secondsOut).toBeGreaterThan(1700);
    expect(secondsOut).toBeLessThan(2500);

    // Further views do not restock again.
    await getShop(auth, shop.id);
    expect(await prisma.npcShopRestock.count({ where: { shopId: shop.id } })).toBe(1);
  });

  it('restocks exactly once under concurrent first views', async () => {
    const { auth } = await setupShopper();
    const shop = await generalGoods();
    await Promise.all(Array.from({ length: 5 }, () => getShop(auth, shop.id)));
    expect(await prisma.npcShopRestock.count({ where: { shopId: shop.id } })).toBe(1);
  });
});

describe('purchases', () => {
  it('buys atomically: gold, stock, inventory, ledger, and transfer together', async () => {
    const { auth, characterId } = await setupShopper();
    const shop = await generalGoods();
    const detail = (await getShop(auth, shop.id)).json();
    const entry = detail.stock.find((s: { item: { stackable: boolean } }) => s.item.stackable);
    expect(entry).toBeDefined();

    const response = await buy(auth, shop.id, {
      stockEntryId: entry.id,
      quantity: 1,
      idempotencyKey: 'buy-0001',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.totalPrice).toBe(entry.unitPrice);
    expect(BigInt(body.gold)).toBe(100_000n - BigInt(entry.unitPrice));

    const row = await prisma.npcShopStockEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.quantityRemaining).toBe(row.quantityTotal - 1);
    const ledger = await prisma.currencyTransaction.findMany({
      where: { type: 'NPC_PURCHASE' },
    });
    expect(ledger).toHaveLength(1);
    const transfer = await prisma.itemTransfer.findMany({
      where: { toCharacterId: characterId, reason: 'NPC_PURCHASE' },
    });
    expect(transfer).toHaveLength(1);

    // Idempotent replay: no second charge, same purchase id.
    const replay = await buy(auth, shop.id, {
      stockEntryId: entry.id,
      quantity: 1,
      idempotencyKey: 'buy-0001',
    });
    expect(replay.json().purchaseId).toBe(body.purchaseId);
    expect(replay.json().gold).toBe(body.gold);
    expect(await prisma.npcShopPurchase.count()).toBe(1);
  });

  it('rejects purchases from the wrong location', async () => {
    const { auth, characterId } = await setupShopper();
    const shop = await generalGoods();
    const detail = (await getShop(auth, shop.id)).json();
    const city = await prisma.location.findUniqueOrThrow({ where: { slug: 'crownfall-city' } });
    await prisma.character.update({
      where: { id: characterId },
      data: { currentLocationId: city.id },
    });
    const response = await buy(auth, shop.id, {
      stockEntryId: detail.stock[0].id,
      quantity: 1,
      idempotencyKey: 'buy-0002',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('WRONG_LOCATION');
  });

  it('rejects insufficient Gold and insufficient capacity atomically', async () => {
    const { auth, characterId } = await setupShopper(1n);
    const shop = await generalGoods();
    const detail = (await getShop(auth, shop.id)).json();
    const entry = detail.stock[0];

    const poor = await buy(auth, shop.id, {
      stockEntryId: entry.id,
      quantity: 1,
      idempotencyKey: 'buy-0003',
    });
    expect(poor.statusCode).toBe(409);
    expect(poor.json().error.code).toBe('INSUFFICIENT_GOLD');

    // Refill gold but block capacity with a reservation.
    await prisma.currencyAccount.update({
      where: { characterId },
      data: { balance: 100_000n },
    });
    await prisma.inventoryCapacityReservation.create({
      data: { characterId, slots: 22, reason: 'TEST_FILL' }, // starter kit uses 2
    });
    const stackable = detail.stock.find(
      (s: { item: { stackable: boolean; slug: string } }) =>
        s.item.stackable && s.item.slug !== 'lesser-healing-draught',
    );
    if (stackable) {
      const full = await buy(auth, shop.id, {
        stockEntryId: stackable.id,
        quantity: 1,
        idempotencyKey: 'buy-0004',
      });
      expect(full.statusCode).toBe(409);
      expect(full.json().error.code).toBe('INVENTORY_FULL');
      // Nothing was charged.
      const account = await prisma.currencyAccount.findUniqueOrThrow({
        where: { characterId },
      });
      expect(account.balance).toBe(100_000n);
    }
  });

  it('enforces the per-character, per-entry, per-restock limit; a new restock resets it', async () => {
    const { auth } = await setupShopper();
    const shop = await generalGoods();
    const detail = (await getShop(auth, shop.id)).json();
    const entry = detail.stock.find(
      (s: { perCharacterLimit: number; item: { stackable: boolean } }) =>
        s.item.stackable && s.perCharacterLimit >= 2,
    );
    expect(entry).toBeDefined();

    // Ensure enough stock for the limit.
    await prisma.npcShopStockEntry.update({
      where: { id: entry.id },
      data: { quantityRemaining: 99, quantityTotal: 99 },
    });

    const first = await buy(auth, shop.id, {
      stockEntryId: entry.id,
      quantity: entry.perCharacterLimit,
      idempotencyKey: 'buy-0005',
    });
    expect(first.statusCode).toBe(200);
    const over = await buy(auth, shop.id, {
      stockEntryId: entry.id,
      quantity: 1,
      idempotencyKey: 'buy-0006',
    });
    expect(over.statusCode).toBe(409);
    expect(over.json().error.code).toBe('LIMIT_REACHED');

    // Force a new restock: old entries go stale, limits reset with new stock.
    await prisma.npcShop.update({
      where: { id: shop.id },
      data: { nextRestockAt: new Date(0) },
    });
    const fresh = (await getShop(auth, shop.id)).json();
    const stale = await buy(auth, shop.id, {
      stockEntryId: entry.id,
      quantity: 1,
      idempotencyKey: 'buy-0007',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('STOCK_STALE');
    const again = await buy(auth, shop.id, {
      stockEntryId: fresh.stock[0].id,
      quantity: 1,
      idempotencyKey: 'buy-0008',
    });
    expect(again.statusCode).toBe(200);
  });

  it('sells the final unit exactly once under concurrent demand', async () => {
    const shopperA = await setupShopper();
    const shopperB = await setupShopper();
    const shop = await generalGoods();
    const detail = (await getShop(shopperA.auth, shop.id)).json();
    const entry = detail.stock.find((s: { item: { stackable: boolean } }) => s.item.stackable);

    // Exactly one unit left.
    await prisma.npcShopStockEntry.update({
      where: { id: entry.id },
      data: { quantityRemaining: 1 },
    });

    const [a, b] = await Promise.all([
      buy(shopperA.auth, shop.id, {
        stockEntryId: entry.id,
        quantity: 1,
        idempotencyKey: 'race-000a',
      }),
      buy(shopperB.auth, shop.id, {
        stockEntryId: entry.id,
        quantity: 1,
        idempotencyKey: 'race-000b',
      }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);

    const row = await prisma.npcShopStockEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.quantityRemaining).toBe(0); // never negative
    expect(await prisma.npcShopPurchase.count({ where: { stockEntryId: entry.id } })).toBe(1);
    // The loser was not charged.
    const ledgerCount = await prisma.currencyTransaction.count({
      where: { type: 'NPC_PURCHASE' },
    });
    expect(ledgerCount).toBe(1);
  });

  it('reports approximate stock levels, not exact counts', async () => {
    const { auth } = await setupShopper();
    const shop = await generalGoods();
    const detail = (await getShop(auth, shop.id)).json();
    for (const entry of detail.stock) {
      expect(['PLENTY', 'SOME', 'LOW', 'SOLD_OUT']).toContain(entry.stockLevel);
      expect(entry).not.toHaveProperty('quantityRemaining');
      expect(entry).not.toHaveProperty('quantityTotal');
    }
  });
});
