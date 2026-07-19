import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { activeBounties } from '../config/bounties.js';
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

type Auth = { cookie: string; csrf: string; userId: string };
const get = (auth: Auth, url: string) =>
  app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE]: auth.cookie } });
const post = (auth: Auth, url: string, payload: unknown) =>
  app.inject({
    method: 'POST',
    url,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: payload as Record<string, unknown>,
  });

async function makeCharacter(
  opts: { gold?: bigint; location?: string } = {},
): Promise<{ auth: Auth; characterId: string }> {
  const reg = await registerTestUser(app);
  const auth: Auth = { cookie: reg.cookie, csrf: reg.csrf, userId: reg.userId };
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Hero ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'vanguard' },
  });
  expect(created.statusCode, created.body).toBe(201);
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  const loc = await prisma.location.findUniqueOrThrow({
    where: { slug: opts.location ?? 'crownfall-market-district' },
  });
  await prisma.character.update({
    where: { id: character.id },
    data: { currentLocationId: loc.id },
  });
  if (opts.gold !== undefined) {
    await prisma.currencyAccount.update({
      where: { characterId: character.id },
      data: { balance: opts.gold },
    });
  }
  return { auth, characterId: character.id };
}

async function grantStack(characterId: string, slug: string, quantity: number) {
  const item = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug } });
  await prisma.inventoryStack.upsert({
    where: { characterId_itemDefinitionId: { characterId, itemDefinitionId: item.id } },
    create: { characterId, itemDefinitionId: item.id, quantity },
    update: { quantity },
  });
  return item;
}

describe('Bounty board — exactly once per character and cycle', () => {
  it('claims a bounty once, consumes the turn-in, and rejects a second reward this cycle', async () => {
    const { auth, characterId } = await makeCharacter({ gold: 0n });
    const active = activeBounties(new Date());
    const target = active[0]!; // an active bounty this cycle
    const req = target.bounty.requirement;
    await grantStack(characterId, req.itemSlug, req.quantity + 2);

    const first = await post(auth, `/api/v1/bounties/${target.bounty.slug}/claims`, {
      idempotencyKey: 'bounty-key-0001',
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<{ goldAwarded: string }>().goldAwarded).toBe(
      target.bounty.rewardGold.toString(),
    );

    // Exactly one claim row and one reward; the turn-in was consumed once.
    expect(await prisma.bountyClaim.count({ where: { characterId } })).toBe(1);
    const item = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug: req.itemSlug } });
    const stack = await prisma.inventoryStack.findFirst({
      where: { characterId, itemDefinitionId: item.id },
    });
    expect(stack?.quantity).toBe(2); // started with req+2, consumed req

    const balanceAfterFirst = (
      await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } })
    ).balance;

    // A second claim this cycle is an idempotent no-op: no extra Gold, no extra
    // consumption, still one claim row.
    const second = await post(auth, `/api/v1/bounties/${target.bounty.slug}/claims`, {
      idempotencyKey: 'bounty-key-0002',
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ goldAwarded: string }>().goldAwarded).toBe('0');
    expect(await prisma.bountyClaim.count({ where: { characterId } })).toBe(1);
    const stack2 = await prisma.inventoryStack.findFirst({
      where: { characterId, itemDefinitionId: item.id },
    });
    expect(stack2?.quantity).toBe(2);
    const balanceAfterSecond = (
      await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } })
    ).balance;
    expect(balanceAfterSecond).toBe(balanceAfterFirst);
  });

  it('a claim in a past cycle never lets the current cycle be claimed twice', async () => {
    const { auth, characterId } = await makeCharacter();
    const target = activeBounties(new Date())[0]!;
    const req = target.bounty.requirement;
    await grantStack(characterId, req.itemSlug, req.quantity);

    // A stale claim from a different (past) cycle exists.
    await prisma.bountyClaim.create({
      data: {
        characterId,
        cycleId: 'DAILY:2000-01-01',
        bountySlug: target.bounty.slug,
        rewardGold: 1n,
      },
    });

    // The current cycle is still claimable exactly once.
    const claim = await post(auth, `/api/v1/bounties/${target.bounty.slug}/claims`, {
      idempotencyKey: 'bounty-key-0003',
    });
    expect(claim.statusCode, claim.body).toBe(200);
    expect(claim.json<{ goldAwarded: string }>().goldAwarded).toBe(
      target.bounty.rewardGold.toString(),
    );
    // Two claim rows total (the stale past one + this cycle's), never a dup of
    // the same cycle.
    const rows = await prisma.bountyClaim.findMany({ where: { characterId } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.cycleId)).size).toBe(2);
  });

  it('rejects a claim when the turn-in requirement is unmet', async () => {
    const { auth } = await makeCharacter();
    const target = activeBounties(new Date())[0]!;
    const res = await post(auth, `/api/v1/bounties/${target.bounty.slug}/claims`, {
      idempotencyKey: 'bounty-key-0004',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('REQUIREMENT_UNMET');
  });
});

describe('NPC sellback — no guaranteed arbitrage', () => {
  it('buying then immediately selling back always loses Gold', async () => {
    const { auth, characterId } = await makeCharacter({ gold: 10_000n });
    const shop = await prisma.npcShop.findFirstOrThrow({
      where: { slug: 'crownfall-general-goods' },
    });

    // Trigger a restock and pick a stackable stock entry.
    const detail = await get(auth, `/api/v1/npc-shops/${shop.id}`);
    expect(detail.statusCode).toBe(200);
    const entryRow = await prisma.npcShopStockEntry.findFirstOrThrow({
      where: { restock: { shopId: shop.id }, quantityRemaining: { gte: 1 } },
      include: { itemDefinition: true },
    });

    const before = (await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } }))
      .balance;
    const buy = await post(auth, `/api/v1/npc-shops/${shop.id}/purchases`, {
      stockEntryId: entryRow.id,
      quantity: 1,
      idempotencyKey: 'buy-0001',
    });
    expect(buy.statusCode, buy.body).toBe(200);
    const buyCost = BigInt(buy.json<{ totalPrice: string }>().totalPrice);

    const sell = await post(auth, `/api/v1/npc-shops/${shop.id}/sales`, {
      itemSlug: entryRow.itemDefinition.slug,
      quantity: 1,
      idempotencyKey: 'sell-0001',
    });
    expect(sell.statusCode, sell.body).toBe(200);
    const sellProceeds = BigInt(sell.json<{ goldReceived: string }>().goldReceived);

    // Sell price is strictly below buy price — arbitrage is impossible.
    expect(sellProceeds).toBeLessThan(buyCost);
    const after = (await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } }))
      .balance;
    expect(after).toBe(before - buyCost + sellProceeds);
    expect(after).toBeLessThan(before);
  });

  it('is idempotent: replaying a sale does not remove goods or pay twice', async () => {
    const { auth, characterId } = await makeCharacter({ gold: 0n });
    const shop = await prisma.npcShop.findFirstOrThrow({
      where: { slug: 'crownfall-general-goods' },
    });
    await grantStack(characterId, 'meadow-herb', 5);

    const one = await post(auth, `/api/v1/npc-shops/${shop.id}/sales`, {
      itemSlug: 'meadow-herb',
      quantity: 3,
      idempotencyKey: 'sell-dup-0001',
    });
    expect(one.statusCode, one.body).toBe(200);
    const balanceOne = (await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } }))
      .balance;

    const replay = await post(auth, `/api/v1/npc-shops/${shop.id}/sales`, {
      itemSlug: 'meadow-herb',
      quantity: 3,
      idempotencyKey: 'sell-dup-0001',
    });
    expect(replay.statusCode).toBe(200);
    const balanceTwo = (await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } }))
      .balance;
    expect(balanceTwo).toBe(balanceOne); // no second payment
    const item = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug: 'meadow-herb' } });
    const stack = await prisma.inventoryStack.findFirst({
      where: { characterId, itemDefinitionId: item.id },
    });
    expect(stack?.quantity).toBe(2); // 5 - 3, removed once
  });
});

describe('Equipment salvage — preserves destruction and transfer records', () => {
  it('destroys the equipment and grants materials, keeping both economic trails', async () => {
    const { auth, characterId } = await makeCharacter();
    const blade = await prisma.itemDefinition.findUniqueOrThrow({
      where: { slug: 'bronze-longblade' },
    });
    const instance = await prisma.itemInstance.create({
      data: { itemDefinitionId: blade.id, ownerCharacterId: characterId, lockState: 'NONE' },
    });

    const res = await post(auth, '/api/v1/inventory/salvage', {
      itemInstanceId: instance.id,
      idempotencyKey: 'salvage-0001',
    });
    expect(res.statusCode, res.body).toBe(200);
    const materials = res.json<{ materials: Array<{ itemSlug: string; quantity: number }> }>()
      .materials;
    expect(materials.length).toBeGreaterThan(0);

    // The instance is destroyed (a permanent item sink).
    const after = await prisma.itemInstance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(after.destroyedAt).not.toBeNull();

    // Destruction record preserved.
    const destruction = await prisma.itemDestruction.findFirst({
      where: { itemInstanceId: instance.id, reason: 'SALVAGE' },
    });
    expect(destruction).not.toBeNull();
    expect(destruction?.characterId).toBe(characterId);

    // Transfer record for the granted material preserved.
    const material = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug: 'iron-ore' } });
    const transfer = await prisma.itemTransfer.findFirst({
      where: { toCharacterId: characterId, itemDefinitionId: material.id, reason: 'SALVAGE_YIELD' },
    });
    expect(transfer).not.toBeNull();
    const stack = await prisma.inventoryStack.findFirst({
      where: { characterId, itemDefinitionId: material.id },
    });
    expect(stack?.quantity).toBe(materials[0]!.quantity);
  });

  it('rejects salvaging the same instance twice', async () => {
    const { auth, characterId } = await makeCharacter();
    const blade = await prisma.itemDefinition.findUniqueOrThrow({
      where: { slug: 'bronze-longblade' },
    });
    const instance = await prisma.itemInstance.create({
      data: { itemDefinitionId: blade.id, ownerCharacterId: characterId, lockState: 'NONE' },
    });
    const first = await post(auth, '/api/v1/inventory/salvage', {
      itemInstanceId: instance.id,
      idempotencyKey: 'salvage-a',
    });
    expect(first.statusCode).toBe(200);
    const second = await post(auth, '/api/v1/inventory/salvage', {
      itemInstanceId: instance.id,
      idempotencyKey: 'salvage-b',
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('ALREADY_SALVAGED');
  });
});
