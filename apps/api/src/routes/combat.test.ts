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

/** Registers a Vanguard standing in Blackwood Forest. */
async function setupFighter(opts: { locationSlug?: string; xp?: number } = {}) {
  const auth = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Fighter ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'vanguard' },
  });
  expect(created.statusCode).toBe(201);
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  const location = await prisma.location.findUniqueOrThrow({
    where: { slug: opts.locationSlug ?? 'blackwood-forest' },
  });
  const data: { currentLocationId: string; xp?: number; level?: number } = {
    currentLocationId: location.id,
  };
  if (opts.xp !== undefined) {
    data.xp = opts.xp;
    const progression = await prisma.levelProgression.findMany({ orderBy: { level: 'asc' } });
    data.level = progression.filter((p) => p.cumulativeXp <= opts.xp!).at(-1)!.level;
  }
  await prisma.character.update({ where: { id: character.id }, data });
  return { auth, characterId: character.id };
}

function getEncounters(auth: { cookie: string }) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/combat/encounters',
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

function start(
  auth: { cookie: string; csrf: string },
  payload: { encounterSlug: string; idempotencyKey: string },
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/combat/start',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload,
  });
}

function getCombat(auth: { cookie: string }, combatId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/combat/${combatId}`,
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

interface CombatViewLite {
  id: string;
  status: string;
  version: number;
  player: { id: string; hp: number; mp: number };
  enemies: Array<{ id: string; hp: number; defeated: boolean }>;
  log: string[];
  rewards: {
    xp: number;
    gold: string;
    drops: Array<{ name: string; quantity: number }>;
    leftBehind: Array<{ name: string; quantity: number }>;
    leveledUp: boolean;
    level: number;
  } | null;
  usableItems: Array<{ slug: string; quantity: number }>;
}

function command(
  auth: { cookie: string; csrf: string },
  combatId: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/combat/${combatId}/commands`,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload,
  });
}

/** Starts a slime fight and returns the initial view. */
async function startSlimes(
  auth: { cookie: string; csrf: string },
  key = 'combat-0001',
): Promise<CombatViewLite> {
  const response = await start(auth, { encounterSlug: 'slime-hollow', idempotencyKey: key });
  expect(response.statusCode).toBe(200);
  return response.json();
}

/**
 * Attacks the target until the fight is decided (attacks can miss ~5% of
 * the time, so a single "killing blow" would be flaky). Returns the final
 * response body.
 */
async function attackUntilVictory(
  auth: { cookie: string; csrf: string },
  view: CombatViewLite,
  targetId: string,
  keyPrefix: string,
): Promise<CombatViewLite> {
  let current = view;
  for (let swing = 0; swing < 8 && current.status === 'ACTIVE'; swing++) {
    const response = await command(auth, current.id, {
      action: 'ATTACK',
      targetCombatantId: targetId,
      idempotencyKey: `${keyPrefix}-${swing}`,
      expectedVersion: current.version,
    });
    expect(response.statusCode).toBe(200);
    current = response.json();
  }
  expect(current.status).toBe('VICTORY');
  return current;
}

/** Reduces every living enemy to 1 HP so the next attack wins the fight. */
async function weakenEnemies(combatId: string) {
  await prisma.combatantState.updateMany({
    where: { combatId, kind: 'ENEMY', currentHp: { gt: 0 } },
    data: { currentHp: 1 },
  });
  // Leave only one enemy standing for a single killing blow.
  const enemies = await prisma.combatantState.findMany({
    where: { combatId, kind: 'ENEMY' },
    orderBy: { slot: 'asc' },
  });
  for (const enemy of enemies.slice(1)) {
    await prisma.combatantState.update({ where: { id: enemy.id }, data: { currentHp: 0 } });
  }
  return enemies[0]!.id;
}

describe('encounters', () => {
  it('lists seeded encounters at the current location with enemy rosters', async () => {
    const { auth } = await setupFighter();
    const response = await getEncounters(auth);
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      encounters: Array<{ slug: string; kind: string; enemies: Array<{ count: number }> }>;
      activeCombatId: string | null;
    }>();
    expect(body.encounters.map((e) => e.slug)).toEqual([
      'slime-hollow',
      'briar-wolf-pack',
      'ironhide-boar',
    ]);
    expect(body.activeCombatId).toBeNull();
    expect(body.encounters[0]!.enemies[0]!.count).toBe(2);
  });

  it('locks the boss behind level 5 and a recorded Ironhide Boar victory', async () => {
    const { auth, characterId } = await setupFighter({ locationSlug: 'ironroot-mine' });
    const listed = (await getEncounters(auth)).json<{
      encounters: Array<{ slug: string; unlocked: boolean; lockedReason: string | null }>;
    }>();
    const boss = listed.encounters.find((e) => e.slug === 'warden-of-the-hollow-forge')!;
    expect(boss.unlocked).toBe(false);
    expect(boss.lockedReason).toContain('level 5');

    const blocked = await start(auth, {
      encounterSlug: 'warden-of-the-hollow-forge',
      idempotencyKey: 'boss-000001',
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('ENCOUNTER_LOCKED');

    // Level 5 alone is not enough: the elite victory is still missing.
    await prisma.character.update({ where: { id: characterId }, data: { level: 5, xp: 1000 } });
    const stillBlocked = await start(auth, {
      encounterSlug: 'warden-of-the-hollow-forge',
      idempotencyKey: 'boss-000002',
    });
    expect(stillBlocked.statusCode).toBe(403);
    expect(stillBlocked.json().error.message).toContain('Ironhide Boar');

    // Record a boar victory; the gate opens.
    const boar = await prisma.encounterDefinition.findUniqueOrThrow({
      where: { slug: 'ironhide-boar' },
    });
    await prisma.combat.create({
      data: {
        characterId,
        encounterId: boar.id,
        status: 'VICTORY',
        rngSeed: 'test',
        log: [],
        idempotencyKey: 'prior-boar-win',
        completedAt: new Date(),
      },
    });
    const opened = await start(auth, {
      encounterSlug: 'warden-of-the-hollow-forge',
      idempotencyKey: 'boss-000003',
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().status).toBe('ACTIVE');
  });

  it('rejects starting an encounter from another location', async () => {
    const { auth } = await setupFighter({ locationSlug: 'ironroot-mine' });
    const response = await start(auth, {
      encounterSlug: 'slime-hollow',
      idempotencyKey: 'wrong-place1',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NOT_HERE');
  });

  it('drops equipment as a rolled instance with a rarity (Improvement Phase 2)', async () => {
    const { auth, characterId } = await setupFighter({ locationSlug: 'ironroot-mine' });
    // Unlock the boss: level 5 plus a recorded Ironhide Boar victory.
    await prisma.character.update({ where: { id: characterId }, data: { level: 5, xp: 1000 } });
    const boar = await prisma.encounterDefinition.findUniqueOrThrow({
      where: { slug: 'ironhide-boar' },
    });
    await prisma.combat.create({
      data: {
        characterId,
        encounterId: boar.id,
        status: 'VICTORY',
        rngSeed: 'test',
        log: [],
        idempotencyKey: 'boar-win-for-drop',
        completedAt: new Date(),
      },
    });

    const view = (
      await start(auth, {
        encounterSlug: 'warden-of-the-hollow-forge',
        idempotencyKey: 'drop-boss',
      })
    ).json<CombatViewLite>();
    expect(view.status).toBe('ACTIVE');
    await weakenEnemies(view.id);
    const won = await attackUntilVictory(auth, view, view.enemies[0]!.id, 'drop-swing');
    expect(won.status).toBe('VICTORY');

    // The guaranteed forge-gear drop is materialized as an owned instance whose
    // quality was rolled server-side.
    const blade = await prisma.itemInstance.findFirst({
      where: {
        ownerCharacterId: characterId,
        destroyedAt: null,
        itemDefinition: { slug: 'bronze-longblade' },
      },
    });
    expect(blade).not.toBeNull();
    expect(['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY']).toContain(blade!.rarity);
    // COMMON rolls carry no affixes; any higher tier carries at least one.
    const affixCount = Array.isArray(blade!.affixes) ? blade!.affixes.length : 0;
    if (blade!.rarity === 'COMMON') expect(affixCount).toBe(0);
    else expect(affixCount).toBeGreaterThan(0);
  });
});

describe('starting and persistence', () => {
  it('starts a persisted combat awaiting the first command; replays return it', async () => {
    const { auth } = await setupFighter();
    const view = await startSlimes(auth);
    expect(view.status).toBe('ACTIVE');
    expect(view.enemies).toHaveLength(2);

    const replay = await start(auth, {
      encounterSlug: 'slime-hollow',
      idempotencyKey: 'combat-0001',
    });
    expect(replay.json().id).toBe(view.id);
    expect(await prisma.combat.count()).toBe(1);

    const conflict = await start(auth, {
      encounterSlug: 'slime-hollow',
      idempotencyKey: 'combat-0002',
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('COMBAT_ACTIVE');
  });

  it('survives refresh: repeated reads return identical state and no PRNG leak', async () => {
    const { auth } = await setupFighter();
    const view = await startSlimes(auth);
    const first = await getCombat(auth, view.id);
    const second = await getCombat(auth, view.id);
    expect(first.json()).toEqual(second.json());
    // The server-secret seed never appears in any response while active.
    const combat = await prisma.combat.findUniqueOrThrow({ where: { id: view.id } });
    expect(first.body).not.toContain(combat.rngSeed);
    expect(first.body).not.toContain('rngSeed');
    // Refresh persistence also reaches the encounters list.
    const encounters = (await getEncounters(auth)).json();
    expect(encounters.activeCombatId).toBe(view.id);
  });

  it('hides other players battles', async () => {
    const { auth } = await setupFighter();
    const view = await startSlimes(auth);
    const { auth: other } = await setupFighter();
    const response = await getCombat(other, view.id);
    expect(response.statusCode).toBe(404);
  });
});

describe('commands: version and replay', () => {
  it('rejects stale versions and replays without resolving anything', async () => {
    const { auth } = await setupFighter();
    const view = await startSlimes(auth);
    const target = view.enemies[0]!.id;

    const ok = await command(auth, view.id, {
      action: 'ATTACK',
      targetCombatantId: target,
      idempotencyKey: 'cmd-0000001',
      expectedVersion: view.version,
    });
    expect(ok.statusCode).toBe(200);
    const after = ok.json();
    expect(after.version).toBe(view.version + 1);

    // A replay of the same command carries the old version: rejected.
    const replay = await command(auth, view.id, {
      action: 'ATTACK',
      targetCombatantId: target,
      idempotencyKey: 'cmd-0000001',
      expectedVersion: view.version,
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error.code).toBe('STALE_COMBAT_VERSION');
    // Nothing advanced: version and log length unchanged since the success.
    const current = (await getCombat(auth, view.id)).json();
    expect(current.version).toBe(after.version);
    expect(current.log).toEqual(after.log);
  });

  it('validates targets without consuming the turn', async () => {
    const { auth } = await setupFighter();
    const view = await startSlimes(auth);
    const bogus = await command(auth, view.id, {
      action: 'ATTACK',
      targetCombatantId: view.player.id, // not an enemy
      idempotencyKey: 'cmd-badtarget',
      expectedVersion: view.version,
    });
    expect(bogus.statusCode).toBe(400);
    const current = (await getCombat(auth, view.id)).json();
    expect(current.version).toBe(view.version);
  });
});

describe('combat items', () => {
  it('consumes the item exactly once in the successful command transaction', async () => {
    const { auth, characterId } = await setupFighter();
    const view = await startSlimes(auth);
    // Wound the player so the draught has something to heal.
    await prisma.combatantState.updateMany({
      where: { combatId: view.id, kind: 'PLAYER' },
      data: { currentHp: 50 },
    });
    const used = await command(auth, view.id, {
      action: 'ITEM',
      itemSlug: 'lesser-healing-draught',
      idempotencyKey: 'cmd-item-001',
      expectedVersion: view.version,
    });
    expect(used.statusCode).toBe(200);
    const after = used.json();
    expect(after.player.hp).toBeGreaterThan(50 - 10); // healed (minus enemy hits)
    const stack = await prisma.inventoryStack.findFirst({
      where: { characterId, itemDefinition: { slug: 'lesser-healing-draught' } },
    });
    expect(stack?.quantity).toBe(1); // starter kit had 2

    // A stale replay of the same item command consumes nothing.
    const replay = await command(auth, view.id, {
      action: 'ITEM',
      itemSlug: 'lesser-healing-draught',
      idempotencyKey: 'cmd-item-001',
      expectedVersion: view.version,
    });
    expect(replay.statusCode).toBe(409);
    const stackAfter = await prisma.inventoryStack.findFirst({
      where: { characterId, itemDefinition: { slug: 'lesser-healing-draught' } },
    });
    expect(stackAfter?.quantity).toBe(1);
  });

  it('rejects items that are not combat-usable and failed commands consume nothing', async () => {
    const { auth, characterId } = await setupFighter();
    // Give the character a non-combat item.
    const ore = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug: 'copper-ore' } });
    await prisma.inventoryStack.create({
      data: { characterId, itemDefinitionId: ore.id, quantity: 5 },
    });
    const view = await startSlimes(auth);
    const rejected = await command(auth, view.id, {
      action: 'ITEM',
      itemSlug: 'copper-ore',
      idempotencyKey: 'cmd-item-bad',
      expectedVersion: view.version,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe('ITEM_NOT_USABLE');
    const stack = await prisma.inventoryStack.findFirst({
      where: { characterId, itemDefinitionId: ore.id },
    });
    expect(stack?.quantity).toBe(5);
  });
});

describe('victory', () => {
  it('settles rewards exactly once: XP, Gold ledger entry, drops, marker', async () => {
    const { auth, characterId } = await setupFighter();
    const view = await startSlimes(auth);
    const targetId = await weakenEnemies(view.id);
    const before = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    const balanceBefore = (
      await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } })
    ).balance;

    const won = await attackUntilVictory(auth, view, targetId, 'cmd-win');
    expect(won.rewards).not.toBeNull();
    expect(won.rewards!.xp).toBe(18); // two slimes × 9

    const after = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(after.xp).toBe(before.xp + 18);
    const balanceAfter = (
      await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } })
    ).balance;
    expect(balanceAfter - balanceBefore).toBe(BigInt(won.rewards!.gold));
    const ledger = await prisma.currencyTransaction.count({
      where: { account: { characterId }, type: 'COMBAT_REWARD' },
    });
    expect(ledger).toBe(1);
    expect(await prisma.combatRewardGrant.count({ where: { combatId: view.id } })).toBe(1);

    // Rewards cannot be duplicated: no further commands resolve.
    const again = await command(auth, view.id, {
      action: 'ATTACK',
      targetCombatantId: targetId,
      idempotencyKey: 'cmd-win-0002',
      expectedVersion: won.version,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('COMBAT_OVER');
    expect(await prisma.combatRewardGrant.count({ where: { combatId: view.id } })).toBe(1);
    expect(
      await prisma.currencyTransaction.count({
        where: { account: { characterId }, type: 'COMBAT_REWARD' },
      }),
    ).toBe(1);
  });

  it('reveals the seed only after completion is possible (never in the view)', async () => {
    const { auth } = await setupFighter();
    const view = await startSlimes(auth);
    const targetId = await weakenEnemies(view.id);
    const won = await attackUntilVictory(auth, view, targetId, 'cmd-seed');
    const combat = await prisma.combat.findUniqueOrThrow({ where: { id: view.id } });
    // Even the completed view keeps the seed out of the public contract.
    expect(JSON.stringify(won)).not.toContain(combat.rngSeed);
  });
});

describe('defeat', () => {
  it('ends exactly once: home to Crownfall, 40% restore rounded up, capped fee, never negative', async () => {
    const { auth, characterId } = await setupFighter();
    const view = await startSlimes(auth);
    // Nearly dead with little Gold: the fee must clamp to the balance.
    await prisma.combatantState.updateMany({
      where: { combatId: view.id, kind: 'PLAYER' },
      data: { currentHp: 1 },
    });
    await prisma.currencyAccount.update({ where: { characterId }, data: { balance: 3n } });

    // Defend until the slimes finish the job (poison or hits).
    let current = (await getCombat(auth, view.id)).json();
    for (let round = 0; round < 30 && current.status === 'ACTIVE'; round++) {
      const response = await command(auth, view.id, {
        action: 'DEFEND',
        idempotencyKey: `cmd-lose-${round.toString().padStart(4, '0')}`,
        expectedVersion: current.version,
      });
      expect(response.statusCode).toBe(200);
      current = response.json();
    }
    expect(current.status).toBe('DEFEAT');

    const character = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      include: { class: true, currentLocation: true },
    });
    expect(character.currentLocation?.slug).toBe('crownfall-city');
    expect(character.currentHp).toBe(Math.ceil(character.class.baseHp * 0.4));
    expect(character.currentMp).toBe(Math.ceil(character.class.baseMp * 0.4));
    const account = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
    expect(account.balance).toBe(0n); // fee clamped to the 3 Gold on hand
    const fees = await prisma.currencyTransaction.findMany({
      where: { account: { characterId }, type: 'COMBAT_RECOVERY' },
    });
    expect(fees).toHaveLength(1);
    expect(fees[0]!.amount).toBe(-3n);
  });
});
