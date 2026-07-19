import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { promoteToAdmin } from '../domain/admin/admin-bootstrap.js';
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

const PASSWORD = 'a test passphrase';
const PREFIX = 'studio-test';
type Auth = { cookie: string; csrf: string; userId: string };

beforeAll(async () => {
  prisma = createTestPrisma();
  app = await buildTestApp(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

/** Removes registry rows and any live content this suite authored. */
async function cleanContent(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ContentDefinition", "ContentRelease" RESTART IDENTITY CASCADE',
  );
  const where = { slug: { startsWith: PREFIX } };
  await prisma.npcShop.deleteMany({ where });
  await prisma.encounterDefinition.deleteMany({ where });
  await prisma.questDefinition.deleteMany({ where });
  await prisma.craftingRecipe.deleteMany({ where });
  await prisma.gatheringActionDefinition.deleteMany({ where });
  await prisma.collectionDefinition.deleteMany({ where });
  await prisma.location.deleteMany({ where }); // cascades routes, features, modifiers
  await prisma.itemDefinition.deleteMany({ where });
}

beforeEach(async () => {
  await truncateAll(prisma);
  await cleanContent();
});
afterEach(cleanContent);

async function login(email: string): Promise<Auth> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: TEST_ORIGIN },
    payload: { email, password: PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  const body = res.json<{ user: { id: string }; csrfToken: string }>();
  return { cookie, csrf: body.csrfToken, userId: body.user.id };
}

async function makeAdmin(opts: { reauth?: boolean } = {}): Promise<Auth> {
  const unique = Math.random().toString(36).slice(2, 10);
  const email = `cadmin-${unique}@example.com`;
  await registerTestUser(app, { email, displayName: `CAdmin${unique}` });
  await promoteToAdmin(prisma, { identifier: email, nodeEnv: 'test', bootstrapEnabled: undefined });
  const auth = await login(email);
  if (opts.reauth !== false) {
    const reauth = await post(auth, '/api/v1/admin/reauth', { password: PASSWORD });
    expect(reauth.statusCode).toBe(200);
  }
  return auth;
}

function get(auth: { cookie: string }, url: string) {
  return app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE]: auth.cookie } });
}
function body(auth: Auth, method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}
const post = (a: Auth, u: string, p?: unknown) => body(a, 'POST', u, p);
const put = (a: Auth, u: string, p?: unknown) => body(a, 'PUT', u, p);

let keySeq = 0;
const idem = () => `content-key-${keySeq++}-${Math.random().toString(36).slice(2, 8)}`;

// --- payload fixtures ------------------------------------------------------

const item = {
  slug: `${PREFIX}-relic`,
  name: 'Test Relic',
  description: 'A relic for the studio acceptance test.',
  category: 'RESOURCE',
  stackable: true,
  maxStackQuantity: 50,
  equipmentSlot: null,
  levelRequirement: 1,
  bonusStrength: 0,
  bonusAgility: 0,
  bonusMagic: 0,
  bonusDefense: 0,
  bonusMagicDefense: 0,
  bonusLuck: 0,
  bonusMaxHp: 0,
  bonusMaxMp: 0,
  hpRestore: 0,
  mpRestore: 0,
  usableInCombat: false,
  baseValue: '25',
};
const location = {
  slug: `${PREFIX}-isle`,
  name: 'Test Isle',
  region: 'Test Reaches',
  description: 'A newly charted isle.',
  artworkKey: 'locations/test-isle',
  isSafe: true,
};
const route = {
  fromSlug: 'crownfall-city',
  toSlug: `${PREFIX}-isle`,
  travelSeconds: 90,
  goldCost: '0',
};
const shop = {
  slug: `${PREFIX}-shop`,
  name: 'Test Isle Trading Post',
  description: 'Sells curios to visitors.',
  locationSlug: `${PREFIX}-isle`,
  markupBps: 12000,
  sellbackBps: 5000,
  poolConfig: {
    restockSlots: 3,
    pool: [
      {
        itemSlug: `${PREFIX}-relic`,
        weight: 10,
        minQuantity: 1,
        maxQuantity: 2,
        perCharacterLimit: 1,
      },
    ],
  },
  restockIntervalSeconds: 1800,
  restockJitterSeconds: 300,
};
const encounter = {
  slug: `${PREFIX}-ambush`,
  name: 'Isle Ambush',
  description: 'Something stirs on the isle.',
  locationSlug: `${PREFIX}-isle`,
  kind: 'NORMAL',
  fleeable: true,
  composition: [{ enemySlug: 'forest-slime', row: 'FRONT' }],
  fleeModifierBps: 0,
  unlockRequirements: null,
  sortOrder: 1,
};
const quest = {
  slug: `${PREFIX}-quest`,
  name: 'Chart the Isle',
  description: 'Travel to the newly charted isle.',
  rewardXp: 100,
  rewardGold: '50',
  rewardItems: [{ itemSlug: `${PREFIX}-relic`, quantity: 1 }],
  sortOrder: 1,
  objectives: [
    {
      sortOrder: 1,
      type: 'TRAVEL_TO_LOCATION',
      targetSlug: `${PREFIX}-isle`,
      requiredCount: 1,
      description: 'Reach Test Isle.',
    },
  ],
};

async function authorSixDefinitions(auth: Auth, releaseId: string): Promise<void> {
  const base = `/api/v1/admin/content/releases/${releaseId}/definitions`;
  const defs: Array<[string, string, unknown]> = [
    ['ITEM', item.slug, item],
    ['LOCATION', location.slug, location],
    ['TRAVEL_ROUTE', `${route.fromSlug}->${route.toSlug}`, route],
    ['NPC_SHOP', shop.slug, shop],
    ['ENCOUNTER', encounter.slug, encounter],
    ['QUEST', quest.slug, quest],
  ];
  for (const [type, key, payload] of defs) {
    const res = await put(auth, `${base}/${type}/${encodeURIComponent(key)}`, { payload });
    expect(res.statusCode, `${type} ${key}: ${res.body}`).toBe(200);
  }
}

async function createDraft(auth: Auth): Promise<{ id: string; version: number }> {
  const res = await post(auth, '/api/v1/admin/content/releases', {
    title: 'Studio acceptance draft',
  });
  expect(res.statusCode, res.body).toBe(200);
  const release = res.json<{ release: { id: string; version: number; status: string } }>().release;
  expect(release.status).toBe('DRAFT');
  return { id: release.id, version: release.version };
}

describe('Content Studio — acceptance test', () => {
  it('authors six content types in a draft, previews, publishes atomically, and content goes live', async () => {
    const admin = await makeAdmin();
    const draft = await createDraft(admin);
    await authorSixDefinitions(admin, draft.id);

    // Validation passes (the new isle is connected, references resolve).
    const validation = await get(admin, `/api/v1/admin/content/releases/${draft.id}/validate`);
    expect(validation.statusCode).toBe(200);
    expect(validation.json<{ result: { ok: boolean } }>().result.ok).toBe(true);

    // Preview resolves the shop's references inside the draft.
    const preview = await get(
      admin,
      `/api/v1/admin/content/releases/${draft.id}/definitions/NPC_SHOP/${shop.slug}/preview`,
    );
    expect(preview.statusCode).toBe(200);
    const refs = preview.json<{ references: Array<{ key: string; resolved: boolean }> }>()
      .references;
    expect(refs.every((r) => r.resolved)).toBe(true);
    expect(refs.map((r) => r.key)).toContain(location.slug);

    // Diff shows the six new definitions as additions.
    const diff = await get(admin, `/api/v1/admin/content/releases/${draft.id}/diff`);
    const added = diff
      .json<{ entries: Array<{ key: string; change: string }> }>()
      .entries.filter((e) => e.change === 'added');
    expect(added.map((e) => e.key)).toEqual(
      expect.arrayContaining([item.slug, location.slug, shop.slug, encounter.slug, quest.slug]),
    );

    // Publish atomically.
    const publish = await post(admin, `/api/v1/admin/content/releases/${draft.id}/publish`, {
      reason: 'Ship the test isle',
      expectedVersion: draft.version,
      idempotencyKey: idem(),
    });
    expect(publish.statusCode, publish.body).toBe(200);
    expect(publish.json<{ release: { status: string } }>().release.status).toBe('PUBLISHED');

    // Content is now live in the tables the engine reads — no code deploy.
    const liveLocation = await prisma.location.findUnique({ where: { slug: location.slug } });
    expect(liveLocation).not.toBeNull();
    const liveItem = await prisma.itemDefinition.findUnique({ where: { slug: item.slug } });
    expect(liveItem?.baseValue).toBe(25n);
    const liveShop = await prisma.npcShop.findUnique({ where: { slug: shop.slug } });
    expect(liveShop?.locationId).toBe(liveLocation!.id);
    const liveEncounter = await prisma.encounterDefinition.findUnique({
      where: { slug: encounter.slug },
    });
    expect(liveEncounter?.locationId).toBe(liveLocation!.id);
    const liveRoute = await prisma.travelRoute.findFirst({
      where: { toLocation: { slug: location.slug } },
    });
    expect(liveRoute).not.toBeNull();
    const liveQuest = await prisma.questDefinition.findUnique({
      where: { slug: quest.slug },
      include: { objectives: true },
    });
    expect(liveQuest?.objectives).toHaveLength(1);
    expect(liveQuest?.objectives[0]?.targetSlug).toBe(location.slug);
  });
});

describe('Content Studio — publication safety', () => {
  it('requires recent re-authentication to publish', async () => {
    const admin = await makeAdmin({ reauth: false });
    const draft = await createDraft(admin); // draft creation is admin-only (allowed)
    const res = await post(admin, `/api/v1/admin/content/releases/${draft.id}/publish`, {
      reason: 'no reauth',
      expectedVersion: draft.version,
      idempotencyKey: idem(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a stale expected version with 409', async () => {
    const admin = await makeAdmin();
    const draft = await createDraft(admin);
    const res = await post(admin, `/api/v1/admin/content/releases/${draft.id}/publish`, {
      reason: 'stale',
      expectedVersion: draft.version + 99,
      idempotencyKey: idem(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('STALE_VERSION');
  });

  it('blocks publishing a bundle that fails validation (disconnected location)', async () => {
    const admin = await makeAdmin();
    const draft = await createDraft(admin);
    // A location with no route in — validation must reject it.
    const island = { ...location, slug: `${PREFIX}-lonely`, name: 'Lonely Rock' };
    const put1 = await put(
      admin,
      `/api/v1/admin/content/releases/${draft.id}/definitions/LOCATION/${island.slug}`,
      { payload: island },
    );
    expect(put1.statusCode).toBe(200);
    const res = await post(admin, `/api/v1/admin/content/releases/${draft.id}/publish`, {
      reason: 'invalid',
      expectedVersion: draft.version,
      idempotencyKey: idem(),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('CONTENT_INVALID');
    // Nothing was applied to the live tables.
    expect(await prisma.location.findUnique({ where: { slug: island.slug } })).toBeNull();
  });

  it('is idempotent: replaying a publish with the same key returns the same release', async () => {
    const admin = await makeAdmin();
    const draft = await createDraft(admin);
    await authorSixDefinitions(admin, draft.id);
    const key = idem();
    const first = await post(admin, `/api/v1/admin/content/releases/${draft.id}/publish`, {
      reason: 'ship',
      expectedVersion: draft.version,
      idempotencyKey: key,
    });
    expect(first.statusCode).toBe(200);
    const second = await post(admin, `/api/v1/admin/content/releases/${draft.id}/publish`, {
      reason: 'ship',
      expectedVersion: draft.version,
      idempotencyKey: key,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ release: { status: string } }>().release.status).toBe('PUBLISHED');
  });

  it('retires a published release without destroying its definitions', async () => {
    const admin = await makeAdmin();
    const draft = await createDraft(admin);
    await authorSixDefinitions(admin, draft.id);
    await post(admin, `/api/v1/admin/content/releases/${draft.id}/publish`, {
      reason: 'ship',
      expectedVersion: draft.version,
      idempotencyKey: idem(),
    });
    const before = await prisma.contentDefinition.count({ where: { releaseId: draft.id } });
    const retire = await post(admin, `/api/v1/admin/content/releases/${draft.id}/retire`, {
      reason: 'superseded',
      idempotencyKey: idem(),
    });
    expect(retire.statusCode).toBe(200);
    expect(retire.json<{ release: { status: string } }>().release.status).toBe('RETIRED');
    const after = await prisma.contentDefinition.count({ where: { releaseId: draft.id } });
    expect(after).toBe(before);
  });

  it('rejects editing a definition once the release is published', async () => {
    const admin = await makeAdmin();
    const draft = await createDraft(admin);
    await authorSixDefinitions(admin, draft.id);
    await post(admin, `/api/v1/admin/content/releases/${draft.id}/publish`, {
      reason: 'ship',
      expectedVersion: draft.version,
      idempotencyKey: idem(),
    });
    const res = await put(
      admin,
      `/api/v1/admin/content/releases/${draft.id}/definitions/ITEM/${item.slug}`,
      { payload: { ...item, name: 'Renamed' } },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_DRAFT');
  });
});

describe('Content Studio — authoring validation and authorization', () => {
  it('rejects a structurally invalid payload at edit time', async () => {
    const admin = await makeAdmin();
    const draft = await createDraft(admin);
    const bad = { ...item, maxStackQuantity: 0 };
    const res = await put(
      admin,
      `/api/v1/admin/content/releases/${draft.id}/definitions/ITEM/${item.slug}`,
      { payload: bad },
    );
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('INVALID_PAYLOAD');
  });

  it('rejects a payload whose slug disagrees with its stable key', async () => {
    const admin = await makeAdmin();
    const draft = await createDraft(admin);
    const res = await put(
      admin,
      `/api/v1/admin/content/releases/${draft.id}/definitions/ITEM/${item.slug}`,
      { payload: { ...item, slug: 'a-different-slug' } },
    );
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('KEY_MISMATCH');
  });

  it('forbids non-admins from the studio', async () => {
    const reg = await registerTestUser(app, {
      email: `plain-${Math.random().toString(36).slice(2, 8)}@example.com`,
      displayName: `Plain${Math.random().toString(36).slice(2, 8)}`,
    });
    const res = await get({ cookie: reg.cookie }, '/api/v1/admin/content/releases');
    expect(res.statusCode).toBe(403);
  });
});
