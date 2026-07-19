import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { abilitiesForClass, LOADOUT_CAPACITY, talentsForClass } from '../config/combat.js';
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
function get(auth: Auth, url: string) {
  return app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE]: auth.cookie } });
}
function send(auth: Auth, method: 'POST' | 'PUT', url: string, payload: unknown) {
  return app.inject({
    method,
    url,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: payload as Record<string, unknown>,
  });
}

async function makeCharacter(
  classSlug: string,
  opts: { level?: number; locationSlug?: string; gold?: bigint } = {},
): Promise<{ auth: Auth; characterId: string }> {
  const reg = await registerTestUser(app);
  const auth: Auth = { cookie: reg.cookie, csrf: reg.csrf, userId: reg.userId };
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Hero ${Math.random().toString(36).slice(2, 8)}`, classSlug },
  });
  expect(created.statusCode, created.body).toBe(201);
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  const data: Record<string, unknown> = {};
  if (opts.level) data.level = opts.level;
  if (opts.locationSlug) {
    const loc = await prisma.location.findUniqueOrThrow({ where: { slug: opts.locationSlug } });
    data.currentLocationId = loc.id;
  }
  if (Object.keys(data).length)
    await prisma.character.update({ where: { id: character.id }, data });
  if (opts.gold !== undefined) {
    await prisma.currencyAccount.update({
      where: { characterId: character.id },
      data: { balance: opts.gold },
    });
  }
  return { auth, characterId: character.id };
}

describe('Acceptance: at least two viable level-30 builds per class', () => {
  it('each class unlocks more abilities than the loadout holds, and every talent tier offers a choice', () => {
    for (const classSlug of ['vanguard', 'wayfarer', 'arcanist']) {
      const unlockedAt30 = abilitiesForClass(classSlug).filter((a) => a.unlockLevel <= 30);
      // More abilities than loadout slots ⇒ more than one distinct loadout.
      expect(unlockedAt30.length).toBeGreaterThan(LOADOUT_CAPACITY);
      for (const tier of [1, 2, 3]) {
        const options = talentsForClass(classSlug).filter((t) => t.tier === tier);
        expect(options.length, `${classSlug} tier ${tier}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('a level-30 character can save two different valid loadouts', async () => {
    const { auth } = await makeCharacter('vanguard', { level: 30 });
    const roster = abilitiesForClass('vanguard').map((a) => a.slug);
    const buildA = roster.slice(0, LOADOUT_CAPACITY);
    const buildB = roster.slice(-LOADOUT_CAPACITY);
    expect(buildA).not.toEqual(buildB);

    const a = await send(auth, 'PUT', '/api/v1/builds/me/loadout', { abilitySlugs: buildA });
    expect(a.statusCode, a.body).toBe(200);
    const b = await send(auth, 'PUT', '/api/v1/builds/me/loadout', { abilitySlugs: buildB });
    expect(b.statusCode, b.body).toBe(200);
    const equipped = b
      .json<{ abilities: Array<{ slug: string; equipped: boolean }> }>()
      .abilities.filter((x) => x.equipped)
      .map((x) => x.slug);
    expect(new Set(equipped)).toEqual(new Set(buildB));
  });

  it('refuses to equip an ability the character has not unlocked', async () => {
    const { auth } = await makeCharacter('vanguard', { level: 1 });
    const locked = abilitiesForClass('vanguard').find((a) => a.unlockLevel > 1)!;
    const res = await send(auth, 'PUT', '/api/v1/builds/me/loadout', {
      abilitySlugs: [locked.slug],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('ABILITY_LOCKED');
  });
});

describe('Acceptance: respecs are exact and audited', () => {
  it('resets the build for a ledger-audited Gold fee and is idempotent', async () => {
    const { auth, characterId } = await makeCharacter('arcanist', { level: 30, gold: 100_000n });
    // Choose a non-default loadout and a talent.
    const roster = abilitiesForClass('arcanist').map((a) => a.slug);
    await send(auth, 'PUT', '/api/v1/builds/me/loadout', {
      abilitySlugs: roster.slice(-LOADOUT_CAPACITY),
    });
    const tier1 = talentsForClass('arcanist').find((t) => t.tier === 1)!;
    await send(auth, 'PUT', '/api/v1/builds/me/talents', { tier: 1, talentSlug: tier1.slug });

    const before = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
    const build = await get(auth, '/api/v1/builds/me');
    const fee = BigInt(build.json<{ respecFeeGold: string }>().respecFeeGold);

    const respec = await send(auth, 'POST', '/api/v1/builds/me/respec', {
      idempotencyKey: 'respec-key-abc12345',
    });
    expect(respec.statusCode, respec.body).toBe(200);
    const body = respec.json<{ talents: Array<{ chosenSlug: string | null }> }>();
    // Exact reset: no talent chosen; the fee was debited exactly once.
    expect(body.talents.every((t) => t.chosenSlug === null)).toBe(true);
    const after = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
    expect(before.balance - after.balance).toBe(fee);

    // Audit trail: an immutable RESPEC_FEE ledger entry exists.
    const ledger = await prisma.currencyTransaction.findFirst({
      where: { account: { characterId }, type: 'RESPEC_FEE' },
    });
    expect(ledger).not.toBeNull();

    // Idempotent replay: same key never double-charges.
    const replay = await send(auth, 'POST', '/api/v1/builds/me/respec', {
      idempotencyKey: 'respec-key-abc12345',
    });
    expect(replay.statusCode).toBe(200);
    const afterReplay = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
    expect(afterReplay.balance).toBe(after.balance);
  });
});

describe('Acceptance: active combats are stable across content publication', () => {
  it('an in-progress battle keeps its start-of-battle snapshot when the enemy definition changes', async () => {
    const { auth, characterId } = await makeCharacter('vanguard', {
      level: 10,
      locationSlug: 'blackwood-forest',
    });
    const start = await send(auth, 'POST', '/api/v1/combat/start', {
      encounterSlug: 'slime-hollow',
      idempotencyKey: `combat-${Math.random().toString(36).slice(2, 10)}`,
    });
    expect(start.statusCode, start.body).toBe(200);
    const combat = await prisma.combat.findFirstOrThrow({ where: { characterId } });
    const enemyBefore = await prisma.combatantState.findFirstOrThrow({
      where: { combatId: combat.id, kind: 'ENEMY' },
    });
    const defBefore = await prisma.enemyDefinition.findUniqueOrThrow({
      where: { slug: 'forest-slime' },
    });

    try {
      // Simulate a content publish (apply-on-publish upserts the live row).
      await prisma.enemyDefinition.update({
        where: { slug: 'forest-slime' },
        data: { maxHp: defBefore.maxHp + 1000, strength: defBefore.strength + 500 },
      });

      // The active battle's snapshot is unchanged — it reads CombatantState.
      const enemyAfter = await prisma.combatantState.findUniqueOrThrow({
        where: { id: enemyBefore.id },
      });
      expect(enemyAfter.maxHp).toBe(enemyBefore.maxHp);
      expect(enemyAfter.strength).toBe(enemyBefore.strength);

      // And the battle is still playable after the publish.
      const view = await get(auth, `/api/v1/combat/${combat.id}`);
      expect(view.statusCode).toBe(200);
      expect(view.json<{ status: string }>().status).toBe('ACTIVE');
    } finally {
      // Restore the seed definition so other suites see the original slime.
      await prisma.enemyDefinition.update({
        where: { slug: 'forest-slime' },
        data: { maxHp: defBefore.maxHp, strength: defBefore.strength },
      });
    }
  });
});

describe('Acceptance: new combat commands are replay-safe (and cooldowns hold)', () => {
  async function startCombat(auth: Auth, characterId: string) {
    const res = await send(auth, 'POST', '/api/v1/combat/start', {
      encounterSlug: 'slime-hollow',
      idempotencyKey: `combat-${Math.random().toString(36).slice(2, 10)}`,
    });
    expect(res.statusCode, res.body).toBe(200);
    const combat = await prisma.combat.findFirstOrThrow({ where: { characterId } });
    return { combatId: combat.id, version: res.json<{ version: number }>().version };
  }

  it('rejects an ability that is on cooldown', async () => {
    // Arcanist's default loadout includes storm-pulse (a 1-turn cooldown).
    const { auth, characterId } = await makeCharacter('arcanist', {
      level: 5,
      locationSlug: 'blackwood-forest',
    });
    const { combatId, version } = await startCombat(auth, characterId);

    // Put storm-pulse on cooldown directly (deterministic, no damage tuning).
    const snap = await prisma.combat.findUniqueOrThrow({ where: { id: combatId } });
    const buildSnapshot = { ...(snap.buildSnapshot as object), cooldowns: { 'storm-pulse': 1 } };
    await prisma.combat.update({ where: { id: combatId }, data: { buildSnapshot } });

    const res = await send(auth, 'POST', `/api/v1/combat/${combatId}/commands`, {
      action: 'MAGIC',
      abilitySlug: 'storm-pulse',
      expectedVersion: version,
      idempotencyKey: 'cmd-cooldown-0001',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('ABILITY_ON_COOLDOWN');
  });

  it('a replayed command with a stale version never resolves twice', async () => {
    const { auth, characterId } = await makeCharacter('vanguard', {
      level: 10,
      locationSlug: 'blackwood-forest',
    });
    const { combatId, version } = await startCombat(auth, characterId);

    const first = await send(auth, 'POST', `/api/v1/combat/${combatId}/commands`, {
      action: 'DEFEND',
      expectedVersion: version,
      idempotencyKey: 'cmd-defend-0001',
    });
    expect(first.statusCode, first.body).toBe(200);
    // A new command at the now-stale version is rejected (a different key, so
    // this is a genuine stale-version replay, not idempotent dedupe).
    const replay = await send(auth, 'POST', `/api/v1/combat/${combatId}/commands`, {
      action: 'DEFEND',
      expectedVersion: version,
      idempotencyKey: 'cmd-defend-0002',
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json<{ error: { code: string } }>().error.code).toBe('STALE_COMBAT_VERSION');
  });
});

describe('level cap', () => {
  it('is raised to 30', async () => {
    const rows = await prisma.levelProgression.findMany({ orderBy: { level: 'desc' }, take: 1 });
    expect(rows[0]?.level).toBe(30);
  });
});
