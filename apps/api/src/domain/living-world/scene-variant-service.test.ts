import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestPrisma } from '../../test-helpers.js';
import { createSceneVariantService } from './scene-variant-service.js';

// An isolated location slug so these rows never collide with seeded variants.
const LOC = 'zzz-scene-variant-test';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createTestPrisma();
  await prisma.sceneVariantDefinition.deleteMany({ where: { locationSlug: LOC } });
  await prisma.sceneVariantDefinition.createMany({
    data: [
      // Event-conditioned, highest priority.
      {
        key: `${LOC}-event`,
        locationSlug: LOC,
        priority: 30,
        eventType: 'MARKET_DAY',
        narration: 'event line',
        status: 'PUBLISHED',
      },
      // Weather-conditioned, mid priority.
      {
        key: `${LOC}-fog`,
        locationSlug: LOC,
        priority: 20,
        weather: 'FOG',
        narration: 'fog line',
        status: 'PUBLISHED',
      },
      // Night-conditioned, low priority.
      {
        key: `${LOC}-night`,
        locationSlug: LOC,
        priority: 10,
        segment: 'NIGHT',
        narration: 'night line',
        status: 'PUBLISHED',
      },
      // A retired variant must never be chosen even if it matches.
      {
        key: `${LOC}-retired`,
        locationSlug: LOC,
        priority: 99,
        weather: 'FOG',
        narration: 'retired line',
        status: 'RETIRED',
      },
    ],
  });
});

afterAll(async () => {
  await prisma.sceneVariantDefinition.deleteMany({ where: { locationSlug: LOC } });
  await prisma.$disconnect();
});

describe('scene-variant selection', () => {
  it('prefers the highest-priority matching published variant', async () => {
    const svc = createSceneVariantService(prisma);
    // FOG + NIGHT + market day active: event (30) beats fog (20) beats night (10).
    const narration = await svc.selectNarration(LOC, {
      segment: 'NIGHT',
      weather: 'FOG',
      eventTypes: ['MARKET_DAY'],
    });
    expect(narration).toBe('event line');
  });

  it('falls through to a lower-priority variant when higher ones do not match', async () => {
    const svc = createSceneVariantService(prisma);
    // No active event; FOG present at night: fog (20) beats night (10).
    expect(
      await svc.selectNarration(LOC, { segment: 'NIGHT', weather: 'FOG', eventTypes: [] }),
    ).toBe('fog line');
    // Clear night: only the night variant matches.
    expect(
      await svc.selectNarration(LOC, { segment: 'NIGHT', weather: 'CLEAR', eventTypes: [] }),
    ).toBe('night line');
  });

  it('returns null when no variant matches, and never picks a retired one', async () => {
    const svc = createSceneVariantService(prisma);
    // DAY + CLEAR + no events: nothing matches (the FOG match is retired).
    expect(
      await svc.selectNarration(LOC, { segment: 'DAY', weather: 'CLEAR', eventTypes: [] }),
    ).toBeNull();
  });
});
