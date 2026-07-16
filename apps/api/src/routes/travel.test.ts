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

async function setupCharacter() {
  const auth = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Rider ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'wayfarer' },
  });
  expect(created.statusCode).toBe(201);
  return auth;
}

function startTravel(
  auth: { cookie: string; csrf: string },
  destinationSlug: string,
  idempotencyKey: string,
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/travel/start',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { destinationSlug, idempotencyKey },
  });
}

function getStatus(auth: { cookie: string }) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/travel/status',
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

/** Backdates the character's in-progress travel so it is logically complete. */
async function expireActiveTravel() {
  await prisma.travelState.updateMany({
    where: { status: 'IN_PROGRESS' },
    data: { completesAt: new Date(Date.now() - 1000) },
  });
}

describe('travel start', () => {
  it('starts travel to a connected destination and reports progress', async () => {
    const auth = await setupCharacter();
    const response = await startTravel(auth, 'north-road', 'trip-0001');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('IN_PROGRESS');
    expect(body.origin.slug).toBe('crownfall-city');
    expect(body.destination.slug).toBe('north-road');
    expect(body.remainingSeconds).toBeGreaterThan(0);

    const status = await getStatus(auth);
    expect(status.json().active.id).toBe(body.id);
  });

  it('rejects an unconnected route', async () => {
    const auth = await setupCharacter();
    const response = await startTravel(auth, 'ironroot-mine', 'trip-0002');
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('NO_ROUTE');
  });

  it('rejects a second different travel while on the road', async () => {
    const auth = await setupCharacter();
    expect((await startTravel(auth, 'north-road', 'trip-0003')).statusCode).toBe(200);
    const second = await startTravel(auth, 'crownfall-harbor', 'trip-0004');
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CURRENTLY_TRAVELING');
  });

  it('is idempotent for the same key', async () => {
    const auth = await setupCharacter();
    const first = await startTravel(auth, 'north-road', 'trip-0005');
    const repeat = await startTravel(auth, 'north-road', 'trip-0005');
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().id).toBe(first.json().id);
    const count = await prisma.travelState.count();
    expect(count).toBe(1);
  });
});

describe('while traveling', () => {
  it('the character is at neither origin nor destination for local actions', async () => {
    const auth = await setupCharacter();
    await startTravel(auth, 'north-road', 'trip-0006');

    for (const url of [
      '/api/v1/locations/current',
      '/api/v1/locations/current/features',
      '/api/v1/travel/destinations',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url,
        cookies: { [SESSION_COOKIE]: auth.cookie },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('CURRENTLY_TRAVELING');
    }
    const character = await prisma.character.findFirstOrThrow();
    expect(character.currentLocationId).toBeNull();
  });
});

describe('lazy completion (worker never involved)', () => {
  it('finalizes arrival via status after the timestamp passes', async () => {
    const auth = await setupCharacter();
    await startTravel(auth, 'north-road', 'trip-0007');
    await expireActiveTravel();

    const status = await getStatus(auth);
    expect(status.json().active).toBeNull();

    const location = await app.inject({
      method: 'GET',
      url: '/api/v1/locations/current',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(location.json().location.slug).toBe('north-road');

    const travel = await prisma.travelState.findFirstOrThrow();
    expect(travel.status).toBe('COMPLETED');
    expect(travel.completedAt).not.toBeNull();
  });

  it('a plain refresh of the location page finalizes arrival', async () => {
    const auth = await setupCharacter();
    await startTravel(auth, 'crownfall-market-district', 'trip-0008');
    await expireActiveTravel();

    // No status call — the location request itself lazily finalizes.
    const location = await app.inject({
      method: 'GET',
      url: '/api/v1/locations/current',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(location.statusCode).toBe(200);
    expect(location.json().location.slug).toBe('crownfall-market-district');
  });

  it('finalizes exactly once under concurrent status requests', async () => {
    const auth = await setupCharacter();
    await startTravel(auth, 'north-road', 'trip-0009');
    await expireActiveTravel();

    const responses = await Promise.all([getStatus(auth), getStatus(auth), getStatus(auth)]);
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.json().active).toBeNull();
    }
    const completed = await prisma.travelState.findMany({ where: { status: 'COMPLETED' } });
    expect(completed).toHaveLength(1);
    const character = await prisma.character.findFirstOrThrow({
      include: { currentLocation: true },
    });
    expect(character.currentLocation?.slug).toBe('north-road');
  });

  it('supports chained journeys after arrival', async () => {
    const auth = await setupCharacter();
    await startTravel(auth, 'north-road', 'trip-0010');
    await expireActiveTravel();
    const second = await startTravel(auth, 'greenmeadow-village', 'trip-0011');
    expect(second.statusCode).toBe(200);
    expect(second.json().origin.slug).toBe('north-road');
    await expireActiveTravel();
    const location = await app.inject({
      method: 'GET',
      url: '/api/v1/locations/current',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(location.json().location.slug).toBe('greenmeadow-village');
  });
});
