import type { PrismaClient } from '@prisma/client';
import { MINING_LEVEL_PROGRESSION, miningLevelForXp, miningXpForNextLevel } from '@rpg/shared';
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

/** Registers a character and stands them in the Ironroot Mine galleries. */
async function setupMiner(opts: { miningXp?: number } = {}) {
  const auth = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Miner ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'vanguard' },
  });
  expect(created.statusCode).toBe(201);
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  const mine = await prisma.location.findUniqueOrThrow({ where: { slug: 'ironroot-mine' } });
  await prisma.character.update({
    where: { id: character.id },
    data: { currentLocationId: mine.id },
  });
  if (opts.miningXp) {
    await prisma.characterSkill.create({
      data: { characterId: character.id, skill: 'MINING', xp: opts.miningXp },
    });
  }
  return { auth, characterId: character.id };
}

function getActions(auth: { cookie: string }) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/gathering/actions',
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

function start(
  auth: { cookie: string; csrf: string },
  payload: { actionSlug: string; idempotencyKey: string },
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/gathering/start',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload,
  });
}

function getStatus(auth: { cookie: string }) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/gathering/status',
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

function claim(auth: { cookie: string; csrf: string }) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/gathering/claim',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

/** Rewinds an in-progress run so its completesAt is already in the past. */
async function expireRun(characterId: string) {
  await prisma.gatheringRun.updateMany({
    where: { characterId, status: 'IN_PROGRESS' },
    data: { completesAt: new Date(Date.now() - 1000), startedAt: new Date(Date.now() - 30_000) },
  });
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

describe('mining levels', () => {
  it('derives levels from a strictly monotonic progression with a cap', () => {
    for (let i = 1; i < MINING_LEVEL_PROGRESSION.length; i++) {
      expect(MINING_LEVEL_PROGRESSION[i]!.level).toBe(MINING_LEVEL_PROGRESSION[i - 1]!.level + 1);
      expect(MINING_LEVEL_PROGRESSION[i]!.cumulativeXp).toBeGreaterThan(
        MINING_LEVEL_PROGRESSION[i - 1]!.cumulativeXp,
      );
    }
    expect(miningLevelForXp(0)).toBe(1);
    expect(miningLevelForXp(19)).toBe(1);
    expect(miningLevelForXp(20)).toBe(2);
    expect(miningLevelForXp(90)).toBe(4);
    expect(miningLevelForXp(999_999)).toBe(10); // cap
    expect(miningXpForNextLevel(1)).toBe(20);
    expect(miningXpForNextLevel(10)).toBeNull();
  });

  it('reports skill progress and per-action unlock state from the actions endpoint', async () => {
    const { auth } = await setupMiner({ miningXp: 25 }); // level 2
    const response = await getActions(auth);
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      skill: { level: number; xp: number; xpForNextLevel: number };
      actions: Array<{ slug: string; levelRequirement: number; unlocked: boolean }>;
    }>();
    expect(body.skill).toMatchObject({ level: 2, xp: 25, xpForNextLevel: 50 });
    expect(body.actions.map((a) => a.slug)).toEqual([
      'mine-copper-seam',
      'mine-iron-vein',
      'search-crystal-pocket',
    ]);
    const bySlug = new Map(body.actions.map((a) => [a.slug, a]));
    expect(bySlug.get('mine-copper-seam')!.unlocked).toBe(true);
    expect(bySlug.get('mine-iron-vein')!.unlocked).toBe(true);
    expect(bySlug.get('search-crystal-pocket')!.unlocked).toBe(false); // needs level 4
  });

  it('rejects starting an action above the character skill level', async () => {
    const { auth } = await setupMiner();
    const response = await start(auth, {
      actionSlug: 'search-crystal-pocket',
      idempotencyKey: 'too-low-001',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('SKILL_TOO_LOW');
  });
});

describe('reward tables', () => {
  it('seeds three Ironroot Mine actions with valid weighted tables over real items', async () => {
    const mine = await prisma.location.findUniqueOrThrow({ where: { slug: 'ironroot-mine' } });
    const actions = await prisma.gatheringActionDefinition.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    expect(actions).toHaveLength(3);
    for (const action of actions) {
      expect(action.locationId).toBe(mine.id);
      expect(action.skill).toBe('MINING');
      const table = action.rewardTable as {
        entries: Array<{
          itemSlug: string;
          weight: number;
          minQuantity: number;
          maxQuantity: number;
        }>;
      };
      expect(table.entries.length).toBeGreaterThanOrEqual(2);
      for (const entry of table.entries) {
        const item = await prisma.itemDefinition.findUnique({ where: { slug: entry.itemSlug } });
        expect(item, `${action.slug} rewards unknown item ${entry.itemSlug}`).not.toBeNull();
        expect(item!.stackable).toBe(true);
        expect(entry.weight).toBeGreaterThanOrEqual(1);
        expect(entry.minQuantity).toBeGreaterThanOrEqual(1);
        expect(entry.maxQuantity).toBeGreaterThanOrEqual(entry.minQuantity);
      }
    }
    // Each action rolls against its own distinct table (weights and
    // quantities included, not just item pools).
    const tables = actions.map((a) => JSON.stringify(a.rewardTable));
    expect(new Set(tables).size).toBe(3);
  });

  it('stores a rolled outcome from the action reward table at start and grants exactly that', async () => {
    const { auth, characterId } = await setupMiner();
    const started = await start(auth, {
      actionSlug: 'mine-copper-seam',
      idempotencyKey: 'roll-once-01',
    });
    expect(started.statusCode).toBe(200);

    const run = await prisma.gatheringRun.findFirstOrThrow({ where: { characterId } });
    const outcome = run.outcome as {
      rewards: Array<{ itemSlug: string; quantity: number }>;
      xp: number;
    };
    expect(outcome.rewards).toHaveLength(1);
    expect(['copper-ore', 'iron-ore']).toContain(outcome.rewards[0]!.itemSlug);
    expect(outcome.xp).toBe(8);

    await expireRun(characterId);
    const status = await getStatus(auth);
    expect(status.statusCode).toBe(200);
    const body = status.json();
    // The granted reward is exactly the stored outcome — never rerolled.
    expect(body.lastCompleted.rewards[0]!.item.slug).toBe(outcome.rewards[0]!.itemSlug);
    expect(body.lastCompleted.rewards[0]!.quantity).toBe(outcome.rewards[0]!.quantity);
    const stack = await prisma.inventoryStack.findFirst({
      where: { characterId, itemDefinition: { slug: outcome.rewards[0]!.itemSlug } },
    });
    expect(stack?.quantity).toBe(outcome.rewards[0]!.quantity);
  });
});

describe('starting a run', () => {
  it('charges stamina exactly once, including on idempotent replays', async () => {
    const { auth, characterId } = await setupMiner();
    const before = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });

    const first = await start(auth, {
      actionSlug: 'mine-copper-seam',
      idempotencyKey: 'stamina-0001',
    });
    expect(first.statusCode).toBe(200);
    const afterFirst = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(afterFirst.stamina).toBe(before.stamina - 2);

    // Stale replay: same key returns the same run without a second charge.
    const replay = await start(auth, {
      actionSlug: 'mine-copper-seam',
      idempotencyKey: 'stamina-0001',
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(first.json().id);
    const afterReplay = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(afterReplay.stamina).toBe(before.stamina - 2);
    expect(await prisma.gatheringRun.count({ where: { characterId } })).toBe(1);
  });

  it('rejects insufficient stamina without creating a run', async () => {
    const { auth, characterId } = await setupMiner();
    await prisma.character.update({
      where: { id: characterId },
      data: { stamina: 1, staminaUpdatedAt: new Date() },
    });
    const response = await start(auth, {
      actionSlug: 'mine-copper-seam',
      idempotencyKey: 'no-stamina-1',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INSUFFICIENT_STAMINA');
    expect(await prisma.gatheringRun.count({ where: { characterId } })).toBe(0);
  });

  it('rejects starting from the wrong location', async () => {
    const { auth, characterId } = await setupMiner();
    const city = await prisma.location.findUniqueOrThrow({ where: { slug: 'crownfall-city' } });
    await prisma.character.update({
      where: { id: characterId },
      data: { currentLocationId: city.id },
    });
    const response = await start(auth, {
      actionSlug: 'mine-copper-seam',
      idempotencyKey: 'wrong-place1',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NOT_HERE');
  });

  it('rejects a conflicting run while one is active', async () => {
    const { auth } = await setupMiner();
    const first = await start(auth, {
      actionSlug: 'mine-copper-seam',
      idempotencyKey: 'conflict-001',
    });
    expect(first.statusCode).toBe(200);
    const second = await start(auth, {
      actionSlug: 'mine-copper-seam',
      idempotencyKey: 'conflict-002',
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('GATHERING_ACTIVE');
  });

  it('handles concurrent starts with different keys: exactly one run and one charge', async () => {
    const { auth, characterId } = await setupMiner();
    const before = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    const responses = await raceRequests([
      () => start(auth, { actionSlug: 'mine-copper-seam', idempotencyKey: 'race-000a' }),
      () => start(auth, { actionSlug: 'mine-copper-seam', idempotencyKey: 'race-000b' }),
    ]);
    expectSingleWinner(responses, 200, 409);
    expect(await prisma.gatheringRun.count({ where: { characterId } })).toBe(1);
    const after = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(after.stamina).toBe(before.stamina - 2);
  });
});

describe('pending privacy and completion', () => {
  it('never leaks the rolled reward in start or pending status responses', async () => {
    const { auth } = await setupMiner();
    const started = await start(auth, {
      actionSlug: 'mine-copper-seam',
      idempotencyKey: 'private-0001',
    });
    expect(started.statusCode).toBe(200);
    for (const body of [started.body, (await getStatus(auth)).body]) {
      expect(body).not.toContain('outcome');
      expect(body).not.toContain('reward');
      expect(body).not.toContain('copper-ore');
      expect(body).not.toContain('iron-ore');
      expect(body).not.toContain('quantity');
    }
    const status = (await getStatus(auth)).json();
    expect(status.active.status).toBe('IN_PROGRESS');
    expect(status.active.remainingSeconds).toBeGreaterThan(0);
    expect(status.lastCompleted).toBeNull();
  });

  it('survives refresh without rerolling: the stored outcome never changes', async () => {
    const { auth, characterId } = await setupMiner();
    await start(auth, { actionSlug: 'mine-copper-seam', idempotencyKey: 'no-reroll-01' });
    const first = await prisma.gatheringRun.findFirstOrThrow({ where: { characterId } });
    for (let i = 0; i < 3; i++) await getStatus(auth); // "refreshes"
    const again = await prisma.gatheringRun.findFirstOrThrow({ where: { characterId } });
    expect(again.outcome).toEqual(first.outcome);
    expect(again.status).toBe('IN_PROGRESS');
  });

  it('finalizes lazily after the timestamp and grants rewards + skill XP exactly once', async () => {
    const { auth, characterId } = await setupMiner();
    await start(auth, { actionSlug: 'mine-copper-seam', idempotencyKey: 'complete-001' });
    await expireRun(characterId);

    // Concurrent finalization attempts: the conditional update makes the
    // grant exactly-once.
    const [s1, s2] = await Promise.all([getStatus(auth), getStatus(auth)]);
    expect(s1.statusCode).toBe(200);
    expect(s2.statusCode).toBe(200);

    const run = await prisma.gatheringRun.findFirstOrThrow({ where: { characterId } });
    expect(run.status).toBe('COMPLETED');
    const outcome = run.outcome as { rewards: Array<{ itemSlug: string; quantity: number }> };
    const stack = await prisma.inventoryStack.findFirstOrThrow({
      where: { characterId, itemDefinition: { slug: outcome.rewards[0]!.itemSlug } },
    });
    expect(stack.quantity).toBe(outcome.rewards[0]!.quantity); // granted once
    const skill = await prisma.characterSkill.findUniqueOrThrow({
      where: { characterId_skill: { characterId, skill: 'MINING' } },
    });
    expect(skill.xp).toBe(8); // granted once
    const transfers = await prisma.itemTransfer.count({
      where: { toCharacterId: characterId, reason: 'GATHERING_REWARD' },
    });
    expect(transfers).toBe(1);

    const status = (await getStatus(auth)).json();
    expect(status.active).toBeNull();
    expect(status.lastCompleted.xpAwarded).toBe(8);
  });

  it('works with the worker stopped and is deterministic after start', async () => {
    // No pg-boss worker runs in these tests at all: the timestamp is the
    // authority and finalization is lazy on the next request.
    const { auth, characterId } = await setupMiner();
    await start(auth, { actionSlug: 'mine-copper-seam', idempotencyKey: 'no-worker-01' });
    const stored = await prisma.gatheringRun.findFirstOrThrow({ where: { characterId } });
    await expireRun(characterId);
    const status = (await getStatus(auth)).json();
    const outcome = stored.outcome as { rewards: Array<{ itemSlug: string; quantity: number }> };
    expect(status.lastCompleted.rewards[0]!.item.slug).toBe(outcome.rewards[0]!.itemSlug);
    expect(status.lastCompleted.rewards[0]!.quantity).toBe(outcome.rewards[0]!.quantity);
  });
});

describe('capacity-held rewards', () => {
  it('holds the completed reward when inventory is full, then grants once on claim', async () => {
    const { auth, characterId } = await setupMiner();
    await start(auth, { actionSlug: 'mine-copper-seam', idempotencyKey: 'held-000001' });
    const stored = await prisma.gatheringRun.findFirstOrThrow({ where: { characterId } });
    await fillInventory(characterId);
    await expireRun(characterId);

    // Finalization cannot place the reward: the run parks as REWARD_HELD.
    const status = (await getStatus(auth)).json();
    expect(status.active).toBeNull();
    expect(status.held.id).toBe(stored.id);
    const outcome = stored.outcome as { rewards: Array<{ itemSlug: string; quantity: number }> };
    // The held reward is revealed (the work is done) but not yet granted…
    expect(status.held.rewards[0]!.item.slug).toBe(outcome.rewards[0]!.itemSlug);
    expect(
      await prisma.inventoryStack.findFirst({
        where: { characterId, itemDefinition: { slug: outcome.rewards[0]!.itemSlug } },
      }),
    ).toBeNull();

    // …claiming while still full fails and does not discard or reroll.
    const blocked = await claim(auth);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('INVENTORY_FULL');
    const afterBlocked = await prisma.gatheringRun.findUniqueOrThrow({ where: { id: stored.id } });
    expect(afterBlocked.status).toBe('REWARD_HELD');
    expect(afterBlocked.outcome).toEqual(stored.outcome);

    // A held reward also blocks new work until claimed.
    const busy = await start(auth, {
      actionSlug: 'mine-copper-seam',
      idempotencyKey: 'held-000002',
    });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.code).toBe('GATHERING_ACTIVE');

    // Free capacity → claim grants the exact stored outcome, exactly once.
    await prisma.inventoryCapacityReservation.updateMany({
      where: { characterId, reason: 'TEST_FILL' },
      data: { releasedAt: new Date() },
    });
    const claimed = await claim(auth);
    expect(claimed.statusCode).toBe(200);
    const claimedBody = claimed.json();
    expect(claimedBody.result.rewards[0]!.item.slug).toBe(outcome.rewards[0]!.itemSlug);
    expect(claimedBody.result.rewards[0]!.quantity).toBe(outcome.rewards[0]!.quantity);
    expect(claimedBody.skill.xp).toBe(8);
    const stack = await prisma.inventoryStack.findFirstOrThrow({
      where: { characterId, itemDefinition: { slug: outcome.rewards[0]!.itemSlug } },
    });
    expect(stack.quantity).toBe(outcome.rewards[0]!.quantity);

    // Claiming again is rejected: completion happens once.
    const again = await claim(auth);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('NOTHING_TO_CLAIM');
    expect(stack.quantity).toBe(outcome.rewards[0]!.quantity);
  });

  it('rejects claim when nothing is held', async () => {
    const { auth } = await setupMiner();
    const response = await claim(auth);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NOTHING_TO_CLAIM');
  });
});
