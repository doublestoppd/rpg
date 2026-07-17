import type { PrismaClient } from '@prisma/client';
import {
  BLACKSMITHING_LEVEL_PROGRESSION,
  blacksmithingLevelForXp,
  blacksmithingXpForNextLevel,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { gameConfig } from '../config/game.js';
import { SESSION_COOKIE } from '../plugins/auth-plugin.js';
import { expectSingleWinner, raceRequests } from '../test-concurrency.js';
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

/** Registers a character at the Market District forge with materials. */
async function setupSmith(
  opts: { professionXp?: number; gold?: bigint; materials?: Record<string, number> } = {},
) {
  const auth = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Smith ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'vanguard' },
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
    data: { balance: opts.gold ?? 1000n },
  });
  if (opts.professionXp) {
    await prisma.craftingProfessionProgress.create({
      data: { characterId: character.id, profession: 'BLACKSMITHING', xp: opts.professionXp },
    });
  }
  const materials = opts.materials ?? { 'copper-ore': 9, 'forge-coal': 4 };
  for (const [slug, quantity] of Object.entries(materials)) {
    const item = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug } });
    await prisma.inventoryStack.create({
      data: { characterId: character.id, itemDefinitionId: item.id, quantity },
    });
  }
  return { auth, characterId: character.id };
}

function getRecipes(auth: { cookie: string }) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/crafting/recipes',
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

function start(
  auth: { cookie: string; csrf: string },
  payload: { recipeSlug: string; idempotencyKey: string },
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/crafting/start',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload,
  });
}

function getStatus(auth: { cookie: string }) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/crafting/status',
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

function claim(auth: { cookie: string; csrf: string }) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/crafting/claim',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

/** Rewinds an in-progress run so its completesAt is already in the past. */
async function expireRun(characterId: string) {
  await prisma.craftingRun.updateMany({
    where: { characterId, status: 'IN_PROGRESS' },
    data: { completesAt: new Date(Date.now() - 1000), startedAt: new Date(Date.now() - 60_000) },
  });
}

async function stackOf(characterId: string, slug: string) {
  const stack = await prisma.inventoryStack.findFirst({
    where: { characterId, itemDefinition: { slug } },
  });
  return stack?.quantity ?? 0;
}

async function goldOf(characterId: string) {
  const account = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
  return account.balance;
}

/** Fills every free inventory slot with active capacity reservations. */
async function fillInventory(characterId: string) {
  const stacks = await prisma.inventoryStack.count({ where: { characterId } });
  const instances = await prisma.itemInstance.count({
    where: { ownerCharacterId: characterId, destroyedAt: null, lockState: 'NONE', equipment: null },
  });
  const free = gameConfig.inventoryCapacity - stacks - instances;
  await prisma.inventoryCapacityReservation.create({
    data: { characterId, slots: free, reason: 'TEST_FILL' },
  });
}

describe('recipes and profession configuration', () => {
  it('derives Blacksmithing levels from a strictly monotonic progression with a cap', () => {
    for (let i = 1; i < BLACKSMITHING_LEVEL_PROGRESSION.length; i++) {
      expect(BLACKSMITHING_LEVEL_PROGRESSION[i]!.level).toBe(
        BLACKSMITHING_LEVEL_PROGRESSION[i - 1]!.level + 1,
      );
      expect(BLACKSMITHING_LEVEL_PROGRESSION[i]!.cumulativeXp).toBeGreaterThan(
        BLACKSMITHING_LEVEL_PROGRESSION[i - 1]!.cumulativeXp,
      );
    }
    expect(blacksmithingLevelForXp(0)).toBe(1);
    expect(blacksmithingLevelForXp(24)).toBe(1);
    expect(blacksmithingLevelForXp(25)).toBe(2);
    expect(blacksmithingLevelForXp(60)).toBe(3);
    expect(blacksmithingLevelForXp(999_999)).toBe(10); // cap
    expect(blacksmithingXpForNextLevel(1)).toBe(25);
    expect(blacksmithingXpForNextLevel(10)).toBeNull();
  });

  it('seeds three deterministic Forge recipes over real items with XP rewards', async () => {
    const market = await prisma.location.findUniqueOrThrow({
      where: { slug: 'crownfall-market-district' },
    });
    const recipes = await prisma.craftingRecipe.findMany({ orderBy: { sortOrder: 'asc' } });
    expect(recipes.map((r) => r.slug)).toEqual([
      'smelt-copper-ingot',
      'smelt-iron-ingot',
      'forge-bronze-longblade',
    ]);
    for (const recipe of recipes) {
      expect(recipe.locationId).toBe(market.id);
      expect(recipe.profession).toBe('BLACKSMITHING');
      expect(recipe.xpReward).toBeGreaterThanOrEqual(1);
      expect(recipe.goldCost).toBeGreaterThanOrEqual(0n);
      const inputs = recipe.inputs as Array<{ itemSlug: string; quantity: number }>;
      expect(inputs.length).toBeGreaterThanOrEqual(2);
      for (const input of inputs) {
        const item = await prisma.itemDefinition.findUnique({ where: { slug: input.itemSlug } });
        expect(item, `${recipe.slug} input ${input.itemSlug}`).not.toBeNull();
        expect(item!.stackable).toBe(true);
        expect(input.quantity).toBeGreaterThanOrEqual(1);
      }
      const output = await prisma.itemDefinition.findUnique({
        where: { id: recipe.outputItemDefinitionId },
      });
      expect(output).not.toBeNull();
    }
    // The blade chain: ore → ingots → equipment output.
    const blade = recipes.find((r) => r.slug === 'forge-bronze-longblade')!;
    const bladeOutput = await prisma.itemDefinition.findUniqueOrThrow({
      where: { id: blade.outputItemDefinitionId },
    });
    expect(bladeOutput.slug).toBe('bronze-longblade');
    expect(bladeOutput.stackable).toBe(false);
    expect(blade.levelRequirement).toBe(3);
  });

  it('reports profession progress and unlock state from the recipes endpoint', async () => {
    const { auth } = await setupSmith({ professionXp: 30 }); // level 2
    const response = await getRecipes(auth);
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      profession: { level: number; xp: number; xpForNextLevel: number };
      recipes: Array<{ slug: string; unlocked: boolean }>;
    }>();
    expect(body.profession).toMatchObject({ level: 2, xp: 30, xpForNextLevel: 60 });
    const bySlug = new Map(body.recipes.map((r) => [r.slug, r]));
    expect(bySlug.get('smelt-copper-ingot')!.unlocked).toBe(true);
    expect(bySlug.get('smelt-iron-ingot')!.unlocked).toBe(true);
    expect(bySlug.get('forge-bronze-longblade')!.unlocked).toBe(false); // needs 3
  });

  it('rejects starting a recipe above the profession level', async () => {
    const { auth } = await setupSmith();
    const response = await start(auth, {
      recipeSlug: 'forge-bronze-longblade',
      idempotencyKey: 'too-low-0001',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('SKILL_TOO_LOW');
  });
});

describe('starting a run consumes once', () => {
  it('consumes inputs and Gold atomically at start, exactly once across replays', async () => {
    const { auth, characterId } = await setupSmith();
    const goldBefore = await goldOf(characterId);

    const first = await start(auth, {
      recipeSlug: 'smelt-copper-ingot',
      idempotencyKey: 'consume-0001',
    });
    expect(first.statusCode).toBe(200);
    expect(await stackOf(characterId, 'copper-ore')).toBe(6); // 9 - 3
    expect(await stackOf(characterId, 'forge-coal')).toBe(3); // 4 - 1
    expect(await goldOf(characterId)).toBe(goldBefore - 2n);

    // Stale replay: same key returns the same run, consuming nothing again.
    const replay = await start(auth, {
      recipeSlug: 'smelt-copper-ingot',
      idempotencyKey: 'consume-0001',
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(first.json().id);
    expect(await stackOf(characterId, 'copper-ore')).toBe(6);
    expect(await stackOf(characterId, 'forge-coal')).toBe(3);
    expect(await goldOf(characterId)).toBe(goldBefore - 2n);
    expect(await prisma.craftingRun.count({ where: { characterId } })).toBe(1);
    // Exactly one ledger entry for the fee.
    const fees = await prisma.currencyTransaction.count({
      where: { account: { characterId }, type: 'CRAFTING_FEE' },
    });
    expect(fees).toBe(1);
  });

  it('handles concurrent starts with different keys: one winner, one consumption', async () => {
    const { auth, characterId } = await setupSmith();
    const goldBefore = await goldOf(characterId);
    const responses = await raceRequests([
      () => start(auth, { recipeSlug: 'smelt-copper-ingot', idempotencyKey: 'race-000a' }),
      () => start(auth, { recipeSlug: 'smelt-copper-ingot', idempotencyKey: 'race-000b' }),
    ]);
    expectSingleWinner(responses, 200, 409);
    expect(await prisma.craftingRun.count({ where: { characterId } })).toBe(1);
    expect(await stackOf(characterId, 'copper-ore')).toBe(6);
    expect(await goldOf(characterId)).toBe(goldBefore - 2n);
  });

  it('rejects insufficient inputs with nothing consumed and no run', async () => {
    const { auth, characterId } = await setupSmith({
      materials: { 'copper-ore': 2, 'forge-coal': 1 },
    });
    const goldBefore = await goldOf(characterId);
    const response = await start(auth, {
      recipeSlug: 'smelt-copper-ingot',
      idempotencyKey: 'no-input-001',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INSUFFICIENT_ITEMS');
    expect(await stackOf(characterId, 'copper-ore')).toBe(2);
    expect(await stackOf(characterId, 'forge-coal')).toBe(1);
    expect(await goldOf(characterId)).toBe(goldBefore);
    expect(await prisma.craftingRun.count({ where: { characterId } })).toBe(0);
  });

  it('rejects insufficient Gold with inputs untouched (transaction rollback)', async () => {
    const { auth, characterId } = await setupSmith({ gold: 1n });
    const response = await start(auth, {
      recipeSlug: 'smelt-copper-ingot',
      idempotencyKey: 'no-gold-0001',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INSUFFICIENT_GOLD');
    // The input removal happens before the debit in the same transaction;
    // the rollback restores every stack.
    expect(await stackOf(characterId, 'copper-ore')).toBe(9);
    expect(await stackOf(characterId, 'forge-coal')).toBe(4);
    expect(await goldOf(characterId)).toBe(1n);
    expect(await prisma.craftingRun.count({ where: { characterId } })).toBe(0);
  });

  it('rejects starting from the wrong location', async () => {
    const { auth, characterId } = await setupSmith();
    const city = await prisma.location.findUniqueOrThrow({ where: { slug: 'crownfall-city' } });
    await prisma.character.update({
      where: { id: characterId },
      data: { currentLocationId: city.id },
    });
    const response = await start(auth, {
      recipeSlug: 'smelt-copper-ingot',
      idempotencyKey: 'wrong-place1',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NOT_HERE');
  });

  it('rejects a conflicting run while one is active', async () => {
    const { auth } = await setupSmith();
    const first = await start(auth, {
      recipeSlug: 'smelt-copper-ingot',
      idempotencyKey: 'conflict-001',
    });
    expect(first.statusCode).toBe(200);
    const second = await start(auth, {
      recipeSlug: 'smelt-copper-ingot',
      idempotencyKey: 'conflict-002',
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CRAFTING_ACTIVE');
  });

  it('cannot consume goods held on a marketplace listing', async () => {
    // Listing stock moves the quantity off the stack at listing time, so the
    // forge simply cannot reach it: crafting sees insufficient inputs.
    const { auth, characterId } = await setupSmith({
      materials: { 'copper-ore': 3, 'forge-coal': 1 },
    });
    const ore = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug: 'copper-ore' } });
    // Simulate the listing hold exactly as the marketplace does: quantity
    // moved off the active stack.
    await prisma.inventoryStack.updateMany({
      where: { characterId, itemDefinitionId: ore.id },
      data: { quantity: 2 },
    });
    const response = await start(auth, {
      recipeSlug: 'smelt-copper-ingot',
      idempotencyKey: 'listed-input1',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INSUFFICIENT_ITEMS');
  });
});

describe('completion grants once', () => {
  it('finalizes lazily after the timestamp: output + profession XP exactly once', async () => {
    const { auth, characterId } = await setupSmith();
    await start(auth, { recipeSlug: 'smelt-copper-ingot', idempotencyKey: 'complete-001' });
    await expireRun(characterId);

    const [s1, s2] = await Promise.all([getStatus(auth), getStatus(auth)]);
    expect(s1.statusCode).toBe(200);
    expect(s2.statusCode).toBe(200);

    const run = await prisma.craftingRun.findFirstOrThrow({ where: { characterId } });
    expect(run.status).toBe('COMPLETED');
    expect(await stackOf(characterId, 'copper-ingot')).toBe(1); // granted once
    const progress = await prisma.craftingProfessionProgress.findUniqueOrThrow({
      where: { characterId_profession: { characterId, profession: 'BLACKSMITHING' } },
    });
    expect(progress.xp).toBe(10); // granted once
    const grants = await prisma.itemTransfer.count({
      where: { toCharacterId: characterId, reason: 'CRAFTING_OUTPUT' },
    });
    expect(grants).toBe(1);

    const status = (await getStatus(auth)).json();
    expect(status.active).toBeNull();
    expect(status.lastCompleted.output[0]!.item.slug).toBe('copper-ingot');
  });

  it('does not duplicate output across refreshes or start retries after completion', async () => {
    const { auth, characterId } = await setupSmith();
    await start(auth, { recipeSlug: 'smelt-copper-ingot', idempotencyKey: 'no-dupe-0001' });
    await expireRun(characterId);
    for (let i = 0; i < 3; i++) await getStatus(auth); // "refreshes"
    // Retrying the original start replays the completed run — no new work.
    const replay = await start(auth, {
      recipeSlug: 'smelt-copper-ingot',
      idempotencyKey: 'no-dupe-0001',
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().status).toBe('COMPLETED');
    expect(await stackOf(characterId, 'copper-ingot')).toBe(1);
    expect(await prisma.craftingRun.count({ where: { characterId } })).toBe(1);
  });

  it('grants a non-stackable output as an owned instance (Bronze Longblade)', async () => {
    const { auth, characterId } = await setupSmith({
      professionXp: 100, // level 3
      materials: { 'copper-ingot': 2, 'iron-ingot': 1, 'forge-coal': 2 },
    });
    const started = await start(auth, {
      recipeSlug: 'forge-bronze-longblade',
      idempotencyKey: 'blade-00001',
    });
    expect(started.statusCode).toBe(200);
    expect(await stackOf(characterId, 'copper-ingot')).toBe(0);
    expect(await stackOf(characterId, 'iron-ingot')).toBe(0);
    await expireRun(characterId);
    await getStatus(auth);
    const blade = await prisma.itemInstance.findFirstOrThrow({
      where: { ownerCharacterId: characterId, itemDefinition: { slug: 'bronze-longblade' } },
    });
    expect(blade.lockState).toBe('NONE');
    expect(blade.destroyedAt).toBeNull();
  });
});

describe('capacity-held outputs', () => {
  it('holds the finished output when inventory is full, then grants once on claim', async () => {
    const { auth, characterId } = await setupSmith();
    await start(auth, { recipeSlug: 'smelt-copper-ingot', idempotencyKey: 'held-000001' });
    const stored = await prisma.craftingRun.findFirstOrThrow({ where: { characterId } });
    await fillInventory(characterId);
    await expireRun(characterId);

    const status = (await getStatus(auth)).json();
    expect(status.active).toBeNull();
    expect(status.held.id).toBe(stored.id);
    expect(status.held.output[0]!.item.slug).toBe('copper-ingot');
    expect(await stackOf(characterId, 'copper-ingot')).toBe(0);

    // Claiming while still full fails and changes nothing.
    const blocked = await claim(auth);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('INVENTORY_FULL');
    const afterBlocked = await prisma.craftingRun.findUniqueOrThrow({ where: { id: stored.id } });
    expect(afterBlocked.status).toBe('OUTPUT_HELD');
    expect(afterBlocked.output).toEqual(stored.output);

    // A held output blocks new work until collected.
    const busy = await start(auth, {
      recipeSlug: 'smelt-copper-ingot',
      idempotencyKey: 'held-000002',
    });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.code).toBe('CRAFTING_ACTIVE');

    // Free capacity → claim grants the snapshot exactly once.
    await prisma.inventoryCapacityReservation.updateMany({
      where: { characterId, reason: 'TEST_FILL' },
      data: { releasedAt: new Date() },
    });
    const claimed = await claim(auth);
    expect(claimed.statusCode).toBe(200);
    const claimedBody = claimed.json();
    expect(claimedBody.result.output[0]!.item.slug).toBe('copper-ingot');
    expect(claimedBody.profession.xp).toBe(10);
    expect(await stackOf(characterId, 'copper-ingot')).toBe(1);

    const again = await claim(auth);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('NOTHING_TO_CLAIM');
    expect(await stackOf(characterId, 'copper-ingot')).toBe(1);
  });

  it('rejects claim when nothing is held', async () => {
    const { auth } = await setupSmith();
    const response = await claim(auth);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NOTHING_TO_CLAIM');
  });
});
