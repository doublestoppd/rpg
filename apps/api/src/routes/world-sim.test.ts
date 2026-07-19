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

type Auth = { cookie: string; csrf: string };
const get = (auth: Auth, url: string) =>
  app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE]: auth.cookie } });

async function makeCharacter(): Promise<{ auth: Auth; region: string }> {
  const reg = await registerTestUser(app);
  const auth: Auth = { cookie: reg.cookie, csrf: reg.csrf };
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Hero ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'vanguard' },
  });
  expect(created.statusCode, created.body).toBe(201);
  const location = await prisma.location.findUniqueOrThrow({
    where: { slug: 'crownfall-market-district' },
  });
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  await prisma.character.update({
    where: { id: character.id },
    data: { currentLocationId: location.id },
  });
  return { auth, region: location.region };
}

describe('GET /world/time', () => {
  it('returns the authoritative segment and a monotonic cycle id', async () => {
    const { auth } = await makeCharacter();
    const res = await get(auth, '/api/v1/world/time');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(['DAWN', 'DAY', 'DUSK', 'NIGHT']).toContain(body.segment);
    expect(body.cycleId).toMatch(/^C\d+$/);
    expect(new Date(body.segmentEndsAt).getTime()).toBeGreaterThan(
      new Date(body.serverTime).getTime() - 1,
    );
    expect(body.configRevision).toBeGreaterThanOrEqual(1);
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/world/time' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /world/atmosphere', () => {
  it('lazily finalizes the current atmosphere without a worker, idempotently', async () => {
    const { auth, region } = await makeCharacter();

    const first = await get(auth, '/api/v1/world/atmosphere');
    expect(first.statusCode).toBe(200);
    const a = first.json();
    expect(a.region).toBe(region);
    expect(['CLEAR', 'CLOUDY', 'RAIN', 'FOG', 'STORM', 'SNOW']).toContain(a.weather);

    // A second read in the same cycle returns the identical stored atmosphere,
    // and exactly one row exists for (region, cycle) — no worker involved.
    const second = await get(auth, '/api/v1/world/atmosphere');
    expect(second.json()).toEqual(a);

    const rows = await prisma.regionAtmosphereState.findMany({
      where: { region, cycleId: a.cycleId },
    });
    expect(rows).toHaveLength(1);
  });

  it('agrees with the world clock on the current cycle', async () => {
    const { auth } = await makeCharacter();
    const time = (await get(auth, '/api/v1/world/time')).json();
    const atmosphere = (await get(auth, '/api/v1/world/atmosphere')).json();
    expect(atmosphere.cycleId).toBe(time.cycleId);
  });
});
