import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createNpcService } from '../domain/living-world/npc-service.js';
import type { LocationService } from '../domain/location/location-service.js';
import { createWorldClockService } from '../domain/world-sim/world-clock.js';
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

// A 7200s cycle: DAWN 0-20%, DAY 20-60%, DUSK 60-75%, NIGHT 75-100%.
const CYCLE_MS = 7200 * 1000;
const at = (fraction: number) => new Date(100_000 * CYCLE_MS + Math.floor(fraction * CYCLE_MS));
const DAWN = at(0.05);
const DAY = at(0.4);
const NIGHT = at(0.9);

/** A location stub standing in for the character's resolved current location. */
function locationStub(slug: string, region = 'crownfall'): LocationService {
  return {
    getCurrentLocation: async () => ({
      location: {
        slug,
        name: slug,
        region,
        description: '',
        artworkKey: 'x',
        isSafe: true,
      },
    }),
  } as unknown as LocationService;
}

const worldClock = () => createWorldClockService(prisma);

describe('NPC schedule resolution (server-authoritative)', () => {
  it('returns only NPCs whose schedule covers the current location and segment', async () => {
    const svc = createNpcService(prisma, locationStub('crownfall-harbor'), worldClock());

    const night = await svc.listAtCurrentLocation('u', NIGHT);
    const nightKeys = night.npcs.map((n) => n.key);
    expect(night.segment).toBe('NIGHT');
    expect(nightKeys).toContain('captain-yorwen'); // on duty every segment
    expect(nightKeys).not.toContain('old-tomas-dockhand'); // day/dusk only

    const day = await svc.listAtCurrentLocation('u', DAY);
    expect(day.npcs.map((n) => n.key)).toContain('old-tomas-dockhand');
  });

  it('follows a scheduled relocation across locations', async () => {
    const meadow = createNpcService(
      prisma,
      locationStub('greenmeadow-village', 'northmarch'),
      worldClock(),
    );
    const road = createNpcService(prisma, locationStub('north-road', 'northmarch'), worldClock());

    expect((await meadow.listAtCurrentLocation('u', DAWN)).npcs.map((n) => n.key)).toContain(
      'wandering-pell',
    );
    expect((await meadow.listAtCurrentLocation('u', DAY)).npcs.map((n) => n.key)).not.toContain(
      'wandering-pell',
    );
    expect((await road.listAtCurrentLocation('u', DAY)).npcs.map((n) => n.key)).toContain(
      'wandering-pell',
    );
  });

  it('reports availability (present / off-schedule / elsewhere) in the detail view', async () => {
    const harbor = createNpcService(prisma, locationStub('crownfall-harbor'), worldClock());
    expect((await harbor.getNpc('u', 'old-tomas-dockhand', DAY)).availability).toBe('PRESENT');
    expect((await harbor.getNpc('u', 'old-tomas-dockhand', NIGHT)).availability).toBe(
      'OFF_SCHEDULE',
    );
    const city = createNpcService(prisma, locationStub('crownfall-city'), worldClock());
    expect((await city.getNpc('u', 'old-tomas-dockhand', DAY)).availability).toBe('ELSEWHERE');
  });

  it('excludes a retired NPC from listings and detail, without deleting it', async () => {
    const svc = createNpcService(prisma, locationStub('crownfall-city'), worldClock());
    try {
      await prisma.npcDefinition.update({
        where: { key: 'brannic-hearthkeeper' },
        data: { status: 'RETIRED' },
      });
      const list = await svc.listAtCurrentLocation('u', DAWN);
      expect(list.npcs.map((n) => n.key)).not.toContain('brannic-hearthkeeper');
      await expect(svc.getNpc('u', 'brannic-hearthkeeper', DAWN)).rejects.toMatchObject({
        statusCode: 404,
      });
      // The row still exists (retirement is not deletion).
      expect(
        await prisma.npcDefinition.findUnique({ where: { key: 'brannic-hearthkeeper' } }),
      ).not.toBeNull();
    } finally {
      await prisma.npcDefinition.update({
        where: { key: 'brannic-hearthkeeper' },
        data: { status: 'PUBLISHED' },
      });
    }
  });

  it('rejects listing NPCs for a traveling character (no current location)', async () => {
    const traveling = {
      getCurrentLocation: async () => {
        throw Object.assign(new Error('traveling'), { statusCode: 409 });
      },
    } as unknown as LocationService;
    const svc = createNpcService(prisma, traveling, worldClock());
    await expect(svc.listAtCurrentLocation('u')).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('NPC endpoints', () => {
  async function makeCharacterAt(slug: string): Promise<string> {
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
    return reg.cookie;
  }

  it('lists NPCs at the current location and returns NPC detail', async () => {
    const cookie = await makeCharacterAt('crownfall-city');
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/locations/current/npcs',
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(['DAWN', 'DAY', 'DUSK', 'NIGHT']).toContain(body.segment);
    // Brannic keeps the hearth every segment, so he is always present here.
    expect(body.npcs.map((n: { key: string }) => n.key)).toContain('brannic-hearthkeeper');
    for (const n of body.npcs) expect(n.availability).toBe('PRESENT');

    const detail = await app.inject({
      method: 'GET',
      url: '/api/v1/npcs/brannic-hearthkeeper',
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().scheduleSegments).toEqual(
      expect.arrayContaining(['DAWN', 'DAY', 'DUSK', 'NIGHT']),
    );
  });

  it('404s an unknown NPC and 401s without a session', async () => {
    const cookie = await makeCharacterAt('crownfall-city');
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/v1/npcs/does-not-exist',
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(unknown.statusCode).toBe(404);

    const unauth = await app.inject({ method: 'GET', url: '/api/v1/locations/current/npcs' });
    expect(unauth.statusCode).toBe(401);
  });
});
