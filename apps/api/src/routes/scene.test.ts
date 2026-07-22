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
  await prisma.worldEventOccurrence.deleteMany({});
});

const get = (cookie: string, url: string) =>
  app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE]: cookie } });

async function makeCharacterAt(slug: string): Promise<{ cookie: string; characterId: string }> {
  const reg = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': reg.csrf },
    cookies: { [SESSION_COOKIE]: reg.cookie },
    payload: { name: `Hero ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'vanguard' },
  });
  expect(created.statusCode, created.body).toBe(201);
  const loc = await prisma.location.findUniqueOrThrow({ where: { slug } });
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  await prisma.character.update({
    where: { id: character.id },
    data: { currentLocationId: loc.id },
  });
  return { cookie: reg.cookie, characterId: character.id };
}

describe('GET /locations/current/scene', () => {
  it('returns one coherent scene read model', async () => {
    const { cookie } = await makeCharacterAt('crownfall-market-district');
    const res = await get(cookie, '/api/v1/locations/current/scene');
    expect(res.statusCode, res.body).toBe(200);
    const scene = res.json();

    expect(scene.location.slug).toBe('crownfall-market-district');
    expect(['DAWN', 'DAY', 'DUSK', 'NIGHT']).toContain(scene.segment);
    expect(scene.atmosphere.region).toBe('crownfall');
    expect(Array.isArray(scene.events)).toBe(true);
    expect(Array.isArray(scene.activity)).toBe(true);
    // Mira keeps the market stall every segment, so she is in the scene.
    expect(scene.npcs.map((n: { key: string }) => n.key)).toContain('mira-coinwright');
    // The scene's time agrees with the standalone world clock.
    const time = (await get(cookie, '/api/v1/world/time')).json();
    expect(scene.cycleId).toBe(time.cycleId);
  });

  it('exposes world events for the region', async () => {
    const { cookie } = await makeCharacterAt('crownfall-city');
    const res = await get(cookie, '/api/v1/world/events');
    expect(res.statusCode).toBe(200);
    expect(res.json().region).toBe('crownfall');
  });
});

describe('GET /locations/current/activity (privacy-safe)', () => {
  it('surfaces verified events without leaking character identity', async () => {
    const { cookie, characterId: viewerId } = await makeCharacterAt('crownfall-city');

    // A donor (a different character) donates to the museum collection housed
    // at crownfall-city, creating a verified domain record.
    const donor = await makeCharacterAt('crownfall-city');
    const entry = await prisma.collectionEntry.findFirst({
      where: { collection: { location: { slug: 'crownfall-city' } } },
      include: { itemDefinition: true, collection: true },
    });
    expect(entry, 'seed has a museum collection at crownfall-city').not.toBeNull();
    await prisma.characterCollectionDonation.create({
      data: {
        characterId: donor.characterId,
        collectionEntryId: entry!.id,
        itemDefinitionId: entry!.itemDefinitionId,
      },
    });

    const res = await get(cookie, '/api/v1/locations/current/activity');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const donation = body.entries.find((e: { type: string }) => e.type === 'MUSEUM_DONATION');
    expect(donation).toBeDefined();
    expect(donation.itemName).toBe(entry!.itemDefinition.name);
    expect(donation.collectionName).toBe(entry!.collection.name);

    // Privacy: no character ids or names anywhere in the feed payload.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(donor.characterId);
    expect(raw).not.toContain(viewerId);
    const donorRow = await prisma.character.findUniqueOrThrow({
      where: { id: donor.characterId },
    });
    expect(raw).not.toContain(donorRow.name);
  });
});
