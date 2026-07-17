import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { gameConfig } from '../config/game.js';
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

type Auth = { cookie: string; csrf: string };

async function setupAdventurer(locationSlug = 'crownfall-city') {
  const auth = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Seeker ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'vanguard' },
  });
  expect(created.statusCode).toBe(201);
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  const location = await prisma.location.findUniqueOrThrow({ where: { slug: locationSlug } });
  await prisma.character.update({
    where: { id: character.id },
    data: { currentLocationId: location.id },
  });
  return { auth, characterId: character.id };
}

function getQuests(auth: { cookie: string }) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/quests',
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

interface QuestViewLite {
  id: string;
  slug: string;
  status: string;
  claimable: boolean;
  objectives: Array<{ currentCount: number; requiredCount: number; completed: boolean }>;
  rewards: { xp: number; gold: string; items: Array<{ name: string; quantity: number }> };
}

async function questBySlug(auth: { cookie: string }, slug: string): Promise<QuestViewLite> {
  const response = await getQuests(auth);
  expect(response.statusCode).toBe(200);
  const body = response.json() as { quests: QuestViewLite[] };
  const quest = body.quests.find((q) => q.slug === slug);
  expect(quest, `quest ${slug}`).toBeDefined();
  return quest!;
}

function accept(auth: Auth, questId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/quests/${questId}/accept`,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

function claim(auth: Auth, questId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/quests/${questId}/claim`,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

/** Completes a mining run whose outcome is forced to the given rewards. */
async function mineWithForcedOutcome(
  auth: Auth,
  characterId: string,
  rewards: Array<{ itemSlug: string; quantity: number }>,
  key: string,
) {
  const started = await app.inject({
    method: 'POST',
    url: '/api/v1/gathering/start',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { actionSlug: 'mine-copper-seam', idempotencyKey: key },
  });
  expect(started.statusCode).toBe(200);
  const withIds = await Promise.all(
    rewards.map(async (reward) => {
      const item = await prisma.itemDefinition.findUniqueOrThrow({
        where: { slug: reward.itemSlug },
      });
      return { itemDefinitionId: item.id, itemSlug: reward.itemSlug, quantity: reward.quantity };
    }),
  );
  await prisma.gatheringRun.updateMany({
    where: { characterId, status: 'IN_PROGRESS' },
    data: {
      outcome: { rewards: withIds, xp: 8 },
      completesAt: new Date(Date.now() - 1000),
    },
  });
  // Lazy finalization grants the rewards and emits the event.
  const status = await app.inject({
    method: 'GET',
    url: '/api/v1/gathering/status',
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
  expect(status.statusCode).toBe(200);
}

/** Wins one slime-hollow fight (two Forest Slimes) with a single blow. */
async function winSlimeFight(auth: Auth, key: string) {
  const started = await app.inject({
    method: 'POST',
    url: '/api/v1/combat/start',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { encounterSlug: 'slime-hollow', idempotencyKey: key },
  });
  expect(started.statusCode).toBe(200);
  const view = started.json() as { id: string; version: number };
  await prisma.combatantState.updateMany({
    where: { combatId: view.id, kind: 'ENEMY' },
    data: { currentHp: 1 },
  });
  const enemies = await prisma.combatantState.findMany({
    where: { combatId: view.id, kind: 'ENEMY' },
    orderBy: { slot: 'asc' },
  });
  for (const enemy of enemies.slice(1)) {
    await prisma.combatantState.update({ where: { id: enemy.id }, data: { currentHp: 0 } });
  }
  const won = await app.inject({
    method: 'POST',
    url: `/api/v1/combat/${view.id}/commands`,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: {
      action: 'ATTACK',
      targetCombatantId: enemies[0]!.id,
      idempotencyKey: `${key}-win`,
      expectedVersion: view.version,
    },
  });
  expect(won.statusCode).toBe(200);
  expect((won.json() as { status: string }).status).toBe('VICTORY');
}

describe('quest configuration', () => {
  it('seeds five typed quests with valid objectives and rewards', async () => {
    const quests = await prisma.questDefinition.findMany({
      include: { objectives: true },
      orderBy: { sortOrder: 'asc' },
    });
    expect(quests.map((q) => q.slug)).toEqual([
      'errand-to-the-market',
      'copper-for-the-forges',
      'prove-your-metal',
      'thin-the-hollow',
      'a-gift-for-the-museum',
    ]);
    const types = quests.flatMap((q) => q.objectives.map((o) => o.type)).sort();
    expect(types).toEqual([
      'CRAFT_RECIPE',
      'DEFEAT_ENEMY',
      'DONATE_ITEM',
      'GATHER_ITEM',
      'TRAVEL_TO_LOCATION',
    ]);
    for (const quest of quests) {
      expect(quest.rewardXp).toBeGreaterThan(0);
      expect(quest.rewardGold).toBeGreaterThan(0n);
      for (const objective of quest.objectives) {
        expect(objective.requiredCount).toBeGreaterThanOrEqual(1);
        expect(objective.targetSlug.length).toBeGreaterThan(0);
      }
    }
  });

  it('lists quests with NOT_ACCEPTED status and full reward details', async () => {
    const { auth } = await setupAdventurer();
    const quest = await questBySlug(auth, 'copper-for-the-forges');
    expect(quest.status).toBe('NOT_ACCEPTED');
    expect(quest.claimable).toBe(false);
    expect(quest.rewards.items).toEqual([{ name: 'Forge Coal', quantity: 2 }]);
  });
});

describe('acceptance and progress gating', () => {
  it('counts progress only after acceptance — prior actions never count', async () => {
    const { auth, characterId } = await setupAdventurer('ironroot-mine');
    // Mine copper BEFORE accepting: must not count.
    await mineWithForcedOutcome(
      auth,
      characterId,
      [{ itemSlug: 'copper-ore', quantity: 4 }],
      'pre-accept-01',
    );

    const quest = await questBySlug(auth, 'copper-for-the-forges');
    const accepted = await accept(auth, quest.id);
    expect(accepted.statusCode).toBe(200);
    expect((accepted.json() as QuestViewLite).objectives[0]!.currentCount).toBe(0);

    // Mining AFTER acceptance counts the granted quantities.
    await mineWithForcedOutcome(
      auth,
      characterId,
      [{ itemSlug: 'copper-ore', quantity: 4 }],
      'post-accept-1',
    );
    let current = await questBySlug(auth, 'copper-for-the-forges');
    expect(current.status).toBe('ACTIVE');
    expect(current.objectives[0]!.currentCount).toBe(4);

    await mineWithForcedOutcome(
      auth,
      characterId,
      [{ itemSlug: 'copper-ore', quantity: 3 }],
      'post-accept-2',
    );
    current = await questBySlug(auth, 'copper-for-the-forges');
    expect(current.status).toBe('COMPLETED_UNCLAIMED');
    expect(current.objectives[0]!.currentCount).toBe(6); // capped at required
    expect(current.claimable).toBe(true);
  });

  it('rejects double acceptance', async () => {
    const { auth } = await setupAdventurer();
    const quest = await questBySlug(auth, 'errand-to-the-market');
    expect((await accept(auth, quest.id)).statusCode).toBe(200);
    const again = await accept(auth, quest.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_ACCEPTED');
  });

  it('rejects forged progress: no progress endpoint exists and early claims fail', async () => {
    const { auth } = await setupAdventurer();
    const quest = await questBySlug(auth, 'errand-to-the-market');
    await accept(auth, quest.id);
    const forged = await app.inject({
      method: 'POST',
      url: `/api/v1/quests/${quest.id}/progress`,
      headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
      cookies: { [SESSION_COOKIE]: auth.cookie },
      payload: { currentCount: 999 },
    });
    expect(forged.statusCode).toBe(404); // the route simply does not exist
    const early = await claim(auth, quest.id);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('NOT_CLAIMABLE');
    // Nothing moved.
    const after = await questBySlug(auth, 'errand-to-the-market');
    expect(after.objectives[0]!.currentCount).toBe(0);
  });
});

describe('event-driven updates', () => {
  it('travel arrival completes the travel quest inside the arrival transaction', async () => {
    const { auth } = await setupAdventurer('crownfall-city');
    const quest = await questBySlug(auth, 'errand-to-the-market');
    await accept(auth, quest.id);

    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/travel/start',
      headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
      cookies: { [SESSION_COOKIE]: auth.cookie },
      payload: { destinationSlug: 'crownfall-market-district', idempotencyKey: 'quest-travel' },
    });
    expect(started.statusCode).toBe(200);
    // Force the arrival timestamp into the past; the next status request
    // lazily finalizes the travel and emits the event.
    await prisma.travelState.updateMany({
      where: { status: 'IN_PROGRESS' },
      data: { completesAt: new Date(Date.now() - 1000) },
    });
    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/travel/status',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(status.statusCode).toBe(200);

    const after = await questBySlug(auth, 'errand-to-the-market');
    expect(after.status).toBe('COMPLETED_UNCLAIMED');
  });

  it('crafting completions advance the crafting quest', async () => {
    const { auth, characterId } = await setupAdventurer('crownfall-market-district');
    const ore = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug: 'copper-ore' } });
    const coal = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug: 'forge-coal' } });
    await prisma.inventoryStack.create({
      data: { characterId, itemDefinitionId: ore.id, quantity: 6 },
    });
    await prisma.inventoryStack.create({
      data: { characterId, itemDefinitionId: coal.id, quantity: 2 },
    });
    const quest = await questBySlug(auth, 'prove-your-metal');
    await accept(auth, quest.id);

    for (const key of ['quest-craft-1', 'quest-craft-2']) {
      const started = await app.inject({
        method: 'POST',
        url: '/api/v1/crafting/start',
        headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
        cookies: { [SESSION_COOKIE]: auth.cookie },
        payload: { recipeSlug: 'smelt-copper-ingot', idempotencyKey: key },
      });
      expect(started.statusCode).toBe(200);
      await prisma.craftingRun.updateMany({
        where: { characterId, status: 'IN_PROGRESS' },
        data: { completesAt: new Date(Date.now() - 1000) },
      });
      const status = await app.inject({
        method: 'GET',
        url: '/api/v1/crafting/status',
        cookies: { [SESSION_COOKIE]: auth.cookie },
      });
      expect(status.statusCode).toBe(200);
    }

    const after = await questBySlug(auth, 'prove-your-metal');
    expect(after.status).toBe('COMPLETED_UNCLAIMED');
    expect(after.objectives[0]!.currentCount).toBe(2);
  });

  it('combat victories count each defeated enemy toward the combat quest', async () => {
    const { auth } = await setupAdventurer('blackwood-forest');
    const quest = await questBySlug(auth, 'thin-the-hollow');
    await accept(auth, quest.id);

    await winSlimeFight(auth, 'quest-fight-1');
    let current = await questBySlug(auth, 'thin-the-hollow');
    expect(current.status).toBe('ACTIVE');
    expect(current.objectives[0]!.currentCount).toBe(2); // two slimes per fight

    await winSlimeFight(auth, 'quest-fight-2');
    current = await questBySlug(auth, 'thin-the-hollow');
    expect(current.status).toBe('COMPLETED_UNCLAIMED');
    expect(current.objectives[0]!.currentCount).toBe(3); // capped at required
  });

  it('the museum quest is acceptable but cannot progress before Phase 14', async () => {
    const { auth } = await setupAdventurer();
    const quest = await questBySlug(auth, 'a-gift-for-the-museum');
    expect((await accept(auth, quest.id)).statusCode).toBe(200);
    const after = await questBySlug(auth, 'a-gift-for-the-museum');
    expect(after.status).toBe('ACTIVE');
    expect(after.objectives[0]!.currentCount).toBe(0);
  });
});

describe('claiming', () => {
  /** Accepts + completes the travel quest, returning its id. */
  async function completeTravelQuest(auth: Auth) {
    const quest = await questBySlug(auth, 'errand-to-the-market');
    await accept(auth, quest.id);
    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/travel/start',
      headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
      cookies: { [SESSION_COOKIE]: auth.cookie },
      payload: { destinationSlug: 'crownfall-market-district', idempotencyKey: 'claim-travel' },
    });
    expect(started.statusCode).toBe(200);
    await prisma.travelState.updateMany({
      where: { status: 'IN_PROGRESS' },
      data: { completesAt: new Date(Date.now() - 1000) },
    });
    await app.inject({
      method: 'GET',
      url: '/api/v1/travel/status',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    return quest.id;
  }

  it('claims exactly once: XP, one ledger credit, then ALREADY_CLAIMED', async () => {
    const { auth, characterId } = await setupAdventurer('crownfall-city');
    const questId = await completeTravelQuest(auth);
    const before = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    const balanceBefore = (
      await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } })
    ).balance;

    const claimed = await claim(auth, questId);
    expect(claimed.statusCode).toBe(200);
    const body = claimed.json() as { quest: QuestViewLite; granted: QuestViewLite['rewards'] };
    expect(body.quest.status).toBe('CLAIMED');
    expect(body.granted.xp).toBe(30);

    const after = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(after.xp).toBe(before.xp + 30);
    const balanceAfter = (
      await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } })
    ).balance;
    expect(balanceAfter - balanceBefore).toBe(15n);
    expect(
      await prisma.currencyTransaction.count({
        where: { account: { characterId }, type: 'QUEST_REWARD' },
      }),
    ).toBe(1);

    const again = await claim(auth, questId);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_CLAIMED');
    expect((await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).xp).toBe(
      before.xp + 30,
    );
    expect(
      await prisma.currencyTransaction.count({
        where: { account: { characterId }, type: 'QUEST_REWARD' },
      }),
    ).toBe(1);
  });

  it('capacity-blocked claims stay COMPLETED_UNCLAIMED with nothing granted', async () => {
    const { auth, characterId } = await setupAdventurer('ironroot-mine');
    // Complete the mining quest (its reward includes 2 Forge Coal).
    const quest = await questBySlug(auth, 'copper-for-the-forges');
    await accept(auth, quest.id);
    await mineWithForcedOutcome(
      auth,
      characterId,
      [{ itemSlug: 'copper-ore', quantity: 6 }],
      'cap-claim-01',
    );
    expect((await questBySlug(auth, 'copper-for-the-forges')).claimable).toBe(true);

    // Fill every free slot.
    const stacks = await prisma.inventoryStack.count({ where: { characterId } });
    const instances = await prisma.itemInstance.count({
      where: {
        ownerCharacterId: characterId,
        destroyedAt: null,
        lockState: 'NONE',
        equipment: null,
      },
    });
    await prisma.inventoryCapacityReservation.create({
      data: {
        characterId,
        slots: gameConfig.inventoryCapacity - stacks - instances,
        reason: 'TEST_FILL',
      },
    });

    const before = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    const blocked = await claim(auth, quest.id);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('INVENTORY_FULL');
    const stillUnclaimed = await questBySlug(auth, 'copper-for-the-forges');
    expect(stillUnclaimed.status).toBe('COMPLETED_UNCLAIMED');
    // Nothing granted: XP unchanged and no coal stack.
    const afterBlocked = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(afterBlocked.xp).toBe(before.xp);
    expect(
      await prisma.inventoryStack.findFirst({
        where: { characterId, itemDefinition: { slug: 'forge-coal' } },
      }),
    ).toBeNull();

    // Free space → the claim succeeds exactly once.
    await prisma.inventoryCapacityReservation.updateMany({
      where: { characterId, reason: 'TEST_FILL' },
      data: { releasedAt: new Date() },
    });
    const claimed = await claim(auth, quest.id);
    expect(claimed.statusCode).toBe(200);
    const coal = await prisma.inventoryStack.findFirstOrThrow({
      where: { characterId, itemDefinition: { slug: 'forge-coal' } },
    });
    expect(coal.quantity).toBe(2);
  });
});
