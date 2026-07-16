import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createCharacterService } from '../domain/character/character-service.js';
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

async function createCharacter(
  auth: { cookie: string; csrf: string },
  payload: { name: string; classSlug: string },
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload,
  });
}

describe('seeded configuration', () => {
  it('has three class definitions with starting stats and growth', async () => {
    const classes = await prisma.characterClassDefinition.findMany({ orderBy: { slug: 'asc' } });
    expect(classes.map((c) => c.slug)).toEqual(['arcanist', 'vanguard', 'wayfarer']);
    for (const cls of classes) {
      expect(cls.baseHp).toBeGreaterThan(0);
      expect(cls.baseStamina).toBe(100);
      expect(cls.growthHp).toBeGreaterThan(0);
      expect(cls.description.length).toBeGreaterThan(10);
    }
  });

  it('seeds a strictly monotonic XP table for levels 1-20', async () => {
    const rows = await prisma.levelProgression.findMany({ orderBy: { level: 'asc' } });
    expect(rows).toHaveLength(20);
    expect(rows[0]).toMatchObject({ level: 1, cumulativeXp: 0 });
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.level).toBe(rows[i - 1]!.level + 1);
      expect(rows[i]!.cumulativeXp).toBeGreaterThan(rows[i - 1]!.cumulativeXp);
    }
  });
});

describe('character creation', () => {
  it('creates a character with class starting statistics and starting gold', async () => {
    const auth = await registerTestUser(app);
    const response = await createCharacter(auth, { name: 'Sable Thorn', classSlug: 'vanguard' });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.class.slug).toBe('vanguard');
    expect(body.level).toBe(1);
    expect(body.xp).toBe(0);
    expect(body.xpForNextLevel).toBe(100);
    expect(body.gold).toBe('100');
    expect(body.resources).toEqual({
      hp: 120,
      maxHp: 120,
      mp: 20,
      maxMp: 20,
      stamina: 100,
      maxStamina: 100,
    });
  });

  it('enforces one character per account', async () => {
    const auth = await registerTestUser(app);
    expect(
      (await createCharacter(auth, { name: 'First Blade', classSlug: 'vanguard' })).statusCode,
    ).toBe(201);
    const second = await createCharacter(auth, { name: 'Second Blade', classSlug: 'wayfarer' });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CHARACTER_EXISTS');

    // The database constraint holds even if service checks are bypassed.
    const user = await prisma.user.findFirstOrThrow();
    await expect(
      prisma.character.create({
        data: {
          userId: user.id,
          name: 'Bypass Blade',
          classSlug: 'arcanist',
          currentHp: 1,
          currentMp: 1,
          stamina: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects unknown classes and duplicate names', async () => {
    const first = await registerTestUser(app);
    expect(
      (await createCharacter(first, { name: 'Unique Name', classSlug: 'vanguard' })).statusCode,
    ).toBe(201);

    const second = await registerTestUser(app);
    const dupName = await createCharacter(second, { name: 'Unique Name', classSlug: 'wayfarer' });
    expect(dupName.statusCode).toBe(409);
    expect(dupName.json().error.code).toBe('NAME_TAKEN');

    const badClass = await createCharacter(second, {
      name: 'Other Name',
      classSlug: 'necromancer',
    });
    expect(badClass.statusCode).toBe(400);
  });

  it('each class starts with its seeded statistics', async () => {
    const expectations = [
      { classSlug: 'wayfarer', hp: 95, mp: 30, strength: 10, agility: 14, luck: 10 },
      { classSlug: 'arcanist', hp: 80, mp: 60, strength: 5, agility: 9, luck: 7 },
    ];
    for (const expected of expectations) {
      const auth = await registerTestUser(app);
      await createCharacter(auth, {
        name: `Hero ${expected.classSlug}`,
        classSlug: expected.classSlug,
      });
      const stats = await app.inject({
        method: 'GET',
        url: '/api/v1/characters/me/stats',
        cookies: { [SESSION_COOKIE]: auth.cookie },
      });
      expect(stats.statusCode).toBe(200);
      const body = stats.json();
      expect(body.resources.maxHp).toBe(expected.hp);
      expect(body.resources.maxMp).toBe(expected.mp);
      expect(body.attributes.strength).toBe(expected.strength);
      expect(body.attributes.agility).toBe(expected.agility);
      expect(body.attributes.luck).toBe(expected.luck);
    }
  });

  it('returns NO_CHARACTER before creation', async () => {
    const auth = await registerTestUser(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/characters/me',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NO_CHARACTER');
  });
});

describe('experience and level-up', () => {
  it('crosses a single threshold, restores HP/MP, and supports multi-level gains', async () => {
    const auth = await registerTestUser(app);
    await createCharacter(auth, { name: 'Level Seeker', classSlug: 'vanguard' });
    const characterService = createCharacterService(prisma);
    const character = await prisma.character.findFirstOrThrow();

    // Wound the character so the level-up restore is observable.
    await prisma.character.update({
      where: { id: character.id },
      data: { currentHp: 10, currentMp: 1 },
    });

    // 100 XP → exactly level 2 (threshold), full restore at level 2 maxima.
    const single = await characterService.addExperience(prisma, character.id, 100);
    expect(single).toMatchObject({ level: 2, leveledUp: true, xp: 100 });
    let row = await prisma.character.findUniqueOrThrow({ where: { id: character.id } });
    expect(row.currentHp).toBe(132); // 120 + 12 growth
    expect(row.currentMp).toBe(22);

    // +900 XP → 1000 cumulative → level 5 in one grant (multi-level).
    const multi = await characterService.addExperience(prisma, character.id, 900);
    expect(multi).toMatchObject({ level: 5, leveledUp: true, xp: 1000 });
    row = await prisma.character.findUniqueOrThrow({ where: { id: character.id } });
    expect(row.level).toBe(5);
    expect(row.currentHp).toBe(120 + 12 * 4);

    // Enormous XP caps at level 20.
    const capped = await characterService.addExperience(prisma, character.id, 10_000_000);
    expect(capped.level).toBe(20);
    row = await prisma.character.findUniqueOrThrow({ where: { id: character.id } });
    expect(row.level).toBe(20);

    // At the cap, xpForNextLevel is null in the API response.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/characters/me',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(me.json().xpForNextLevel).toBeNull();
  });
});

describe('stamina', () => {
  it('regenerates lazily by timestamp at the configured whole-unit rate', async () => {
    const auth = await registerTestUser(app);
    await createCharacter(auth, { name: 'Weary Walker', classSlug: 'wayfarer' });
    const character = await prisma.character.findFirstOrThrow();

    // 40 stamina stored 26 minutes ago at 1/5min → +5 whole units = 45.
    await prisma.character.update({
      where: { id: character.id },
      data: { stamina: 40, staminaUpdatedAt: new Date(Date.now() - 26 * 60 * 1000) },
    });
    const stats = await app.inject({
      method: 'GET',
      url: '/api/v1/characters/me/stats',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(stats.json().resources.stamina).toBe(45);

    // Regeneration clamps at the maximum.
    await prisma.character.update({
      where: { id: character.id },
      data: { stamina: 99, staminaUpdatedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const clamped = await app.inject({
      method: 'GET',
      url: '/api/v1/characters/me/stats',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(clamped.json().resources.stamina).toBe(100);
  });

  it('spends stamina against the lazily regenerated value and persists', async () => {
    const auth = await registerTestUser(app);
    await createCharacter(auth, { name: 'Busy Miner', classSlug: 'vanguard' });
    const character = await prisma.character.findFirstOrThrow();
    const characterService = createCharacterService(prisma);

    await prisma.character.update({
      where: { id: character.id },
      data: { stamina: 10, staminaUpdatedAt: new Date(Date.now() - 26 * 60 * 1000) },
    });
    // Effective 15; spending 12 leaves 3 and resets the timestamp.
    const remaining = await characterService.spendStamina(prisma, character.id, 12);
    expect(remaining).toBe(3);
    const row = await prisma.character.findUniqueOrThrow({ where: { id: character.id } });
    expect(row.stamina).toBe(3);

    await expect(characterService.spendStamina(prisma, character.id, 999)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STAMINA',
    });
  });
});
