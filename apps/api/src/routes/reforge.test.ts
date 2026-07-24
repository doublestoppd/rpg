import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createInventoryService, TRANSFER_REASONS } from '../domain/inventory/inventory-service.js';
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

async function setupCharacter() {
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
  return { auth, characterId: character.id };
}

async function setGold(characterId: string, gold: bigint) {
  await prisma.currencyAccount.update({ where: { characterId }, data: { balance: gold } });
}

async function grantInstance(
  characterId: string,
  slug: string,
  rarity: 'COMMON' | 'RARE' = 'RARE',
) {
  const def = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug } });
  return prisma.$transaction((tx) =>
    createInventoryService(prisma).grantInstance(tx, {
      characterId,
      itemDefinitionId: def.id,
      reason: TRANSFER_REASONS.TEST_GRANT,
      rarity,
      affixes:
        rarity === 'RARE'
          ? [
              { stat: 'luck', magnitude: 2, label: 'of Fortune' },
              { stat: 'maxHp', magnitude: 10, label: 'of Vitality' },
            ]
          : [],
    }),
  );
}

function quote(auth: { cookie: string }, itemInstanceId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/reforge/quote?itemInstanceId=${itemInstanceId}`,
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

function reforge(
  auth: { cookie: string; csrf: string },
  body: { itemInstanceId: string; idempotencyKey: string },
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/reforge',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: body,
  });
}

describe('reforge quote', () => {
  it('prices a reforge and reports affordability', async () => {
    const { auth, characterId } = await setupCharacter();
    await setGold(characterId, 10_000n);
    const instance = await grantInstance(characterId, 'apprentice-focus', 'RARE');

    const body = (await quote(auth, instance.id)).json();
    expect(body.rarity).toBe('RARE');
    expect(body.affixes).toHaveLength(2);
    expect(Number(body.cost)).toBeGreaterThan(0);
    expect(body.canReforge).toBe(true);
    expect(body.reason).toBeNull();
  });

  it('reports common gear as not reforgeable', async () => {
    const { auth, characterId } = await setupCharacter();
    const instance = await grantInstance(characterId, 'apprentice-focus', 'COMMON');
    const body = (await quote(auth, instance.id)).json();
    expect(body.canReforge).toBe(false);
    expect(body.reason).toContain('Common');
  });
});

describe('reforge', () => {
  it('charges Gold, rerolls affixes at the same rarity, and is idempotent', async () => {
    const { auth, characterId } = await setupCharacter();
    await setGold(characterId, 10_000n);
    const instance = await grantInstance(characterId, 'apprentice-focus', 'RARE');
    const cost = Number((await quote(auth, instance.id)).json().cost);

    const first = await reforge(auth, {
      itemInstanceId: instance.id,
      idempotencyKey: 'reforge-key-1',
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.rarity).toBe('RARE');
    expect(firstBody.affixes).toHaveLength(2); // rarity preserved
    expect(Number(firstBody.cost)).toBe(cost);
    expect(Number(firstBody.balance)).toBe(10_000 - cost);

    // Replaying the same key never charges or rerolls again.
    const replay = await reforge(auth, {
      itemInstanceId: instance.id,
      idempotencyKey: 'reforge-key-1',
    });
    expect(replay.statusCode).toBe(200);
    const replayBody = replay.json();
    expect(Number(replayBody.cost)).toBe(0);
    expect(Number(replayBody.balance)).toBe(10_000 - cost);
    expect(replayBody.affixes).toEqual(firstBody.affixes);

    // Exactly one fee ledger entry was written.
    const fees = await prisma.currencyTransaction.findMany({
      where: { account: { characterId }, type: 'REFORGE_FEE' },
    });
    expect(fees).toHaveLength(1);
  });

  it('rejects a reforge the character cannot afford', async () => {
    const { auth, characterId } = await setupCharacter();
    await setGold(characterId, 1n);
    const instance = await grantInstance(characterId, 'apprentice-focus', 'RARE');
    const res = await reforge(auth, {
      itemInstanceId: instance.id,
      idempotencyKey: 'too-poor-key',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INSUFFICIENT_GOLD');
  });

  it('rejects reforging common gear', async () => {
    const { auth, characterId } = await setupCharacter();
    await setGold(characterId, 10_000n);
    const instance = await grantInstance(characterId, 'apprentice-focus', 'COMMON');
    const res = await reforge(auth, {
      itemInstanceId: instance.id,
      idempotencyKey: 'common-key-1',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOT_REFORGEABLE');
  });
});
