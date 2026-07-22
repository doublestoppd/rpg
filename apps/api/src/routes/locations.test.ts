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
    payload: { name: `Scout ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'wayfarer' },
  });
  expect(created.statusCode).toBe(201);
  return auth;
}

describe('world graph seed', () => {
  it('has exactly eight locations', async () => {
    const locations = await prisma.location.findMany({ orderBy: { slug: 'asc' } });
    expect(locations.map((l) => l.slug)).toEqual([
      'blackwood-forest',
      'crownfall-city',
      'crownfall-harbor',
      'crownfall-market-district',
      'greenmeadow-village',
      'ironroot-mine',
      'north-road',
      'silvermere-lake',
    ]);
  });

  it('has an explicit directed route graph with bidirectional pairs', async () => {
    const routes = await prisma.travelRoute.findMany({
      include: { fromLocation: true, toLocation: true },
    });
    expect(routes).toHaveLength(16); // 8 roads x 2 directions

    const asSet = new Set(routes.map((r) => `${r.fromLocation.slug}->${r.toLocation.slug}`));
    for (const route of routes) {
      // Every directed record has its explicit reverse record.
      expect(asSet.has(`${route.toLocation.slug}->${route.fromLocation.slug}`)).toBe(true);
      // Initial routes must be free until currency charging exists.
      expect(route.goldCost).toBe(0n);
      expect(route.travelSeconds).toBeGreaterThan(0);
    }
    // No arbitrary shortcuts: the capital does not connect straight to the mine.
    expect(asSet.has('crownfall-city->ironroot-mine')).toBe(false);
  });

  it('places required features: City INN+MUSEUM; Market District NPC_SHOP+MARKETPLACE+CRAFTING; Ironroot GATHERING+COMBAT; Blackwood COMBAT', async () => {
    const features = await prisma.locationFeature.findMany({ include: { location: true } });
    const byLocation = new Map<string, Set<string>>();
    for (const f of features) {
      const set = byLocation.get(f.location.slug) ?? new Set();
      set.add(f.type);
      byLocation.set(f.location.slug, set);
    }
    expect(byLocation.get('crownfall-city')).toEqual(new Set(['INN', 'MUSEUM']));
    expect(byLocation.get('crownfall-market-district')).toEqual(
      new Set(['NPC_SHOP', 'MARKETPLACE', 'CRAFTING']),
    );
    expect(byLocation.get('ironroot-mine')).toEqual(new Set(['GATHERING', 'COMBAT']));
    expect(byLocation.get('blackwood-forest')?.has('COMBAT')).toBe(true);
  });

  it('represents the Forge as Market District features, not a location', async () => {
    const forgeLocation = await prisma.location.findFirst({
      where: { name: { contains: 'Forge' } },
    });
    expect(forgeLocation).toBeNull();

    const forgeFeatures = await prisma.locationFeature.findMany({
      where: { name: 'Crownfall Forge' },
      include: { location: true },
    });
    expect(forgeFeatures.map((f) => f.type).sort()).toEqual(['CRAFTING', 'NPC_SHOP']);
    for (const f of forgeFeatures) {
      expect(f.location.slug).toBe('crownfall-market-district');
    }
  });
});

describe('current location', () => {
  it('new characters start at Crownfall City and the location persists', async () => {
    const auth = await setupCharacter();
    for (let i = 0; i < 2; i++) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/locations/current',
        cookies: { [SESSION_COOKIE]: auth.cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().location.slug).toBe('crownfall-city');
    }
    const character = await prisma.character.findFirstOrThrow({
      include: { currentLocation: true },
    });
    expect(character.currentLocation?.slug).toBe('crownfall-city');
  });

  it('lazily backfills characters created before the world existed', async () => {
    const auth = await setupCharacter();
    await prisma.character.updateMany({ data: { currentLocationId: null } });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/locations/current',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(response.json().location.slug).toBe('crownfall-city');
    const character = await prisma.character.findFirstOrThrow();
    expect(character.currentLocationId).not.toBeNull();
  });

  it('exposes feature availability from database records', async () => {
    const auth = await setupCharacter();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/locations/current/features',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(response.statusCode).toBe(200);
    const types = response.json().features.map((f: { type: string }) => f.type);
    expect(types).toEqual(['INN', 'MUSEUM']);
  });
});

describe('travel destinations', () => {
  it('returns only directly connected destinations', async () => {
    const auth = await setupCharacter();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/travel/destinations',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(response.statusCode).toBe(200);
    const slugs = response
      .json()
      .destinations.map((d: { location: { slug: string } }) => d.location.slug)
      .sort();
    expect(slugs).toEqual(['crownfall-harbor', 'crownfall-market-district', 'north-road']);
    for (const destination of response.json().destinations) {
      expect(destination.goldCost).toBe('0');
      expect(destination.travelSeconds).toBeGreaterThan(0);
    }
  });

  it('reflects the current location after the character moves', async () => {
    const auth = await setupCharacter();
    const mine = await prisma.location.findUniqueOrThrow({ where: { slug: 'ironroot-mine' } });
    await prisma.character.updateMany({ data: { currentLocationId: mine.id } });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/travel/destinations',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    const slugs = response
      .json()
      .destinations.map((d: { location: { slug: string } }) => d.location.slug)
      .sort();
    expect(slugs).toEqual(['blackwood-forest', 'greenmeadow-village']);
  });
});

describe('world map', () => {
  it('returns the whole topology and the caller’s current location', async () => {
    const auth = await setupCharacter();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/world/map',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.locations).toHaveLength(8);
    expect(body.edges).toHaveLength(16); // 8 roads x 2 directions
    expect(body.currentLocationSlug).toBe('crownfall-city');

    // Every edge references known locations.
    const slugs = new Set(body.locations.map((l: { slug: string }) => l.slug));
    for (const edge of body.edges) {
      expect(slugs.has(edge.fromSlug)).toBe(true);
      expect(slugs.has(edge.toSlug)).toBe(true);
      expect(edge.travelSeconds).toBeGreaterThan(0);
    }
  });

  it('reports no current location while traveling', async () => {
    const auth = await setupCharacter();
    await prisma.character.updateMany({ data: { currentLocationId: null } });
    // Unlike the current-location read, the map must not backfill a starting
    // location — a character in transit has no "you are here" pin.
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/world/map',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().currentLocationSlug).toBeNull();
  });
});
