import type { ContentType, PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  NORTHMARCH_DEFINITIONS,
  NORTHMARCH_RELEASE_TITLE,
} from '../domain/content/expansions/northmarch.js';
import { ensureNorthmarchPublished } from '../domain/content/expansions/publish-expansion.js';
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

const keysOf = (t: string) =>
  NORTHMARCH_DEFINITIONS.filter((d) => d.type === (t as ContentType)).map((d) => d.key);

/** Removes the published release and every Northmarch live row this suite added. */
async function cleanupNorthmarch(): Promise<void> {
  // Clear player/gameplay state first so nothing references a Northmarch item.
  await truncateAll(prisma);
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ContentDefinition", "ContentRelease" RESTART IDENTITY CASCADE',
  );
  await prisma.npcShop.deleteMany({ where: { slug: { in: keysOf('NPC_SHOP') } } });
  await prisma.encounterDefinition.deleteMany({ where: { slug: { in: keysOf('ENCOUNTER') } } });
  await prisma.questDefinition.deleteMany({ where: { slug: { in: keysOf('QUEST') } } });
  await prisma.craftingRecipe.deleteMany({ where: { slug: { in: keysOf('CRAFTING_RECIPE') } } });
  await prisma.gatheringActionDefinition.deleteMany({
    where: { slug: { in: keysOf('GATHERING_ACTION') } },
  });
  await prisma.collectionDefinition.deleteMany({ where: { slug: { in: keysOf('COLLECTION') } } });
  await prisma.enemyDefinition.deleteMany({ where: { slug: { in: keysOf('ENEMY') } } });
  await prisma.location.deleteMany({ where: { slug: { in: keysOf('LOCATION') } } }); // cascades routes/features/modifiers
  await prisma.itemDefinition.deleteMany({ where: { slug: { in: keysOf('ITEM') } } });
}

beforeAll(async () => {
  prisma = createTestPrisma();
  app = await buildTestApp(prisma);
  await cleanupNorthmarch(); // start clean if a prior run left rows
  // Publish the whole expansion through the content platform (validate + apply).
  await ensureNorthmarchPublished(prisma);
});

afterAll(async () => {
  await cleanupNorthmarch();
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

function get(auth: { cookie: string }, url: string) {
  return app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE]: auth.cookie } });
}
function post(auth: { cookie: string; csrf: string }, url: string, payload?: unknown) {
  return app.inject({
    method: 'POST',
    url,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

async function makeCharacterAt(
  locationSlug: string,
  opts: { gold?: bigint; materials?: Record<string, number> } = {},
) {
  const auth = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Ranger ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'vanguard' },
  });
  expect(created.statusCode).toBe(201);
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  const location = await prisma.location.findUniqueOrThrow({ where: { slug: locationSlug } });
  await prisma.character.update({
    where: { id: character.id },
    data: { currentLocationId: location.id },
  });
  if (opts.gold !== undefined) {
    await prisma.currencyAccount.update({
      where: { characterId: character.id },
      data: { balance: opts.gold },
    });
  }
  for (const [slug, quantity] of Object.entries(opts.materials ?? {})) {
    const item = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug } });
    await prisma.inventoryStack.create({
      data: { characterId: character.id, itemDefinitionId: item.id, quantity },
    });
  }
  return { auth, characterId: character.id };
}

describe('Northmarch expansion — created through the content platform', () => {
  it('published a PUBLISHED release and materialized the whole region into the live tables', async () => {
    const release = await prisma.contentRelease.findFirstOrThrow({
      where: { title: NORTHMARCH_RELEASE_TITLE },
    });
    expect(release.status).toBe('PUBLISHED');

    // The four new locations exist and the hub hangs off the existing world.
    for (const slug of [
      'northmarch-hold',
      'frostmere-fen',
      'hollowpine-thicket',
      'wyrmwatch-barrow',
    ]) {
      expect(await prisma.location.findUnique({ where: { slug } }), slug).not.toBeNull();
    }
    const gateway = await prisma.travelRoute.findFirst({
      where: { fromLocation: { slug: 'north-road' }, toLocation: { slug: 'northmarch-hold' } },
    });
    expect(gateway).not.toBeNull();

    // Ordinary content is all present.
    expect(await prisma.npcShop.count({ where: { slug: { startsWith: 'northmarch-' } } })).toBe(2);
    expect(
      await prisma.collectionDefinition.findUnique({ where: { slug: 'northmarch-relics' } }),
    ).not.toBeNull();
    expect(await prisma.enemyDefinition.count({ where: { slug: { in: keysOf('ENEMY') } } })).toBe(
      6,
    );

    // The boss encounter carries its unlock gate.
    const boss = await prisma.encounterDefinition.findUniqueOrThrow({
      where: { slug: 'the-fen-wyrm' },
    });
    expect(boss.kind).toBe('BOSS');
    expect(
      (boss.unlockRequirements as { requiresVictoryOverEncounterSlug?: string })
        .requiresVictoryOverEncounterSlug,
    ).toBe('barrow-vigil');
  });

  it('is idempotent: re-publishing the expansion creates nothing new', async () => {
    const again = await ensureNorthmarchPublished(prisma);
    expect(again.created).toBe(false);
    expect(await prisma.contentRelease.count({ where: { title: NORTHMARCH_RELEASE_TITLE } })).toBe(
      1,
    );
  });
});

describe('Herbalism — new timed gathering profession', () => {
  async function expireGathering(characterId: string) {
    await prisma.gatheringRun.updateMany({
      where: { characterId, status: 'IN_PROGRESS' },
      data: { completesAt: new Date(Date.now() - 1000), startedAt: new Date(Date.now() - 30_000) },
    });
  }

  it('gathers herbs, awards Herbalism XP (not Mining), and is idempotent', async () => {
    const { auth, characterId } = await makeCharacterAt('frostmere-fen');

    const actions = await get(auth, '/api/v1/gathering/actions');
    expect(actions.statusCode).toBe(200);
    const actionsBody = actions.json<{
      skill: { skill: string };
      actions: Array<{ slug: string }>;
    }>();
    expect(actionsBody.skill.skill).toBe('HERBALISM');
    expect(actionsBody.actions.map((a) => a.slug)).toContain('gather-frostbell');

    const key = `herb-${Math.random().toString(36).slice(2, 10)}`;
    const start = await post(auth, '/api/v1/gathering/start', {
      actionSlug: 'gather-frostbell',
      idempotencyKey: key,
    });
    expect(start.statusCode).toBe(200);
    const runId = start.json<{ id: string }>().id;
    // Idempotent replay returns the same run without a second charge.
    const replay = await post(auth, '/api/v1/gathering/start', {
      actionSlug: 'gather-frostbell',
      idempotencyKey: key,
    });
    expect(replay.json<{ id: string }>().id).toBe(runId);

    await expireGathering(characterId);
    const status = await get(auth, '/api/v1/gathering/status');
    expect(status.statusCode).toBe(200);
    const last = status.json<{
      lastCompleted: { xpAwarded: number; rewards: Array<{ item: { slug: string } }> };
    }>().lastCompleted;
    expect(last.xpAwarded).toBe(8);
    expect(['frostbell-blossom', 'spring-water-vial']).toContain(last.rewards[0]!.item.slug);

    // XP landed on Herbalism only.
    const herb = await prisma.characterSkill.findUnique({
      where: { characterId_skill: { characterId, skill: 'HERBALISM' } },
    });
    expect(herb?.xp).toBe(8);
    const mining = await prisma.characterSkill.findUnique({
      where: { characterId_skill: { characterId, skill: 'MINING' } },
    });
    expect(mining).toBeNull();
  });
});

describe('Alchemy — new timed crafting profession', () => {
  async function expireCrafting(characterId: string) {
    await prisma.craftingRun.updateMany({
      where: { characterId, status: 'IN_PROGRESS' },
      data: { completesAt: new Date(Date.now() - 1000), startedAt: new Date(Date.now() - 30_000) },
    });
  }

  it('brews an elixir, awards Alchemy XP (not Blacksmithing), and consumes reagents', async () => {
    const { auth, characterId } = await makeCharacterAt('northmarch-hold', {
      gold: 1000n,
      materials: { 'frostbell-blossom': 3, 'spring-water-vial': 2 },
    });

    const recipes = await get(auth, '/api/v1/crafting/recipes');
    expect(recipes.statusCode).toBe(200);
    const recipesBody = recipes.json<{
      profession: { profession: string };
      recipes: Array<{ slug: string }>;
    }>();
    expect(recipesBody.profession.profession).toBe('ALCHEMY');
    expect(recipesBody.recipes.map((r) => r.slug)).toContain('brew-minor-healing-elixir');

    const key = `alch-${Math.random().toString(36).slice(2, 10)}`;
    const start = await post(auth, '/api/v1/crafting/start', {
      recipeSlug: 'brew-minor-healing-elixir',
      idempotencyKey: key,
    });
    expect(start.statusCode, start.body).toBe(200);

    await expireCrafting(characterId);
    const status = await get(auth, '/api/v1/crafting/status');
    expect(status.statusCode).toBe(200);
    const last = status.json<{
      lastCompleted: { xpAwarded: number; output: Array<{ item: { slug: string } }> };
    }>().lastCompleted;
    expect(last.xpAwarded).toBe(10);
    expect(last.output[0]!.item.slug).toBe('minor-healing-elixir');

    // XP landed on Alchemy only; reagents were consumed.
    const alchemy = await prisma.craftingProfessionProgress.findUnique({
      where: { characterId_profession: { characterId, profession: 'ALCHEMY' } },
    });
    expect(alchemy?.xp).toBe(10);
    const smithing = await prisma.craftingProfessionProgress.findUnique({
      where: { characterId_profession: { characterId, profession: 'BLACKSMITHING' } },
    });
    expect(smithing).toBeNull();
    const spring = await prisma.itemDefinition.findUniqueOrThrow({
      where: { slug: 'spring-water-vial' },
    });
    const springStack = await prisma.inventoryStack.findFirst({
      where: { characterId, itemDefinitionId: spring.id },
    });
    expect(springStack?.quantity).toBe(1); // started with 2, one consumed
  });
});
