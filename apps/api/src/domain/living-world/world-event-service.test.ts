import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestPrisma, truncateAll } from '../../test-helpers.js';
import { createWorldClockService } from '../world-sim/world-clock.js';
import { createWorldEventService, occurrenceWindowAt } from './world-event-service.js';

/**
 * World events (Phase 26, increment 4). Recurrence is a pure function of the
 * world-cycle number, and occurrences are finalized lazily and idempotently —
 * proven here without any worker.
 */

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await truncateAll(prisma);
  await prisma.worldEventOccurrence.deleteMany({});
});

describe('occurrenceWindowAt', () => {
  const every2 = { everyCycles: 2, offsetCycles: 0, durationCycles: 1 };
  const storm = { everyCycles: 3, offsetCycles: 1, durationCycles: 1 };

  it('recurs on the configured cadence and offset', () => {
    expect(occurrenceWindowAt(every2, 100)).toEqual({ startCycle: 100 });
    expect(occurrenceWindowAt(every2, 101)).toBeNull();
    expect(occurrenceWindowAt(storm, 1)).toEqual({ startCycle: 1 });
    expect(occurrenceWindowAt(storm, 4)).toEqual({ startCycle: 4 });
    expect(occurrenceWindowAt(storm, 2)).toBeNull();
  });

  it('stays active across a multi-cycle duration', () => {
    const long = { everyCycles: 5, offsetCycles: 0, durationCycles: 3 };
    expect(occurrenceWindowAt(long, 0)).toEqual({ startCycle: 0 });
    expect(occurrenceWindowAt(long, 2)).toEqual({ startCycle: 0 }); // still within [0,3)
    expect(occurrenceWindowAt(long, 3)).toBeNull(); // window closed until cycle 5
  });
});

// A 7200s cycle (the seeded config). An even cycle activates Market Day.
const CYCLE_MS = 7200 * 1000;
const atCycle = (c: number) => new Date(c * CYCLE_MS + CYCLE_MS / 2);

describe('lazy world-event finalization (worker-independent, idempotent)', () => {
  it('finalizes due events once, with no worker, and agrees on replay', async () => {
    const svc = createWorldEventService(prisma, createWorldClockService(prisma), {} as never);
    const now = atCycle(100_000); // even → Market Day active in crownfall

    const first = await svc.activeEvents('crownfall', now);
    expect(first.map((e) => e.key)).toContain('crownfall-market-day');

    // A second read in the same cycle returns the same events and creates no
    // duplicate occurrence — the API path is the sole authority here.
    const second = await svc.activeEvents('crownfall', now);
    expect(second).toEqual(first);
    const rows = await prisma.worldEventOccurrence.findMany({
      where: { eventKey: 'crownfall-market-day', startCycle: 100_000 },
    });
    expect(rows).toHaveLength(1);
  });

  it('does not surface an event outside its active window', async () => {
    const svc = createWorldEventService(prisma, createWorldClockService(prisma), {} as never);
    // Odd cycle → Market Day (every 2, offset 0) is not active.
    const events = await svc.activeEvents('crownfall', atCycle(100_001));
    expect(events.map((e) => e.key)).not.toContain('crownfall-market-day');
  });

  it('snapshots the definition into the occurrence (stable across a later edit)', async () => {
    const svc = createWorldEventService(prisma, createWorldClockService(prisma), {} as never);
    const now = atCycle(100_000);
    await svc.activeEvents('crownfall', now);

    // Edit the live definition; the already-finalized occurrence is unchanged.
    await prisma.worldEventDefinition.update({
      where: { key: 'crownfall-market-day' },
      data: { name: 'Renamed Market Day' },
    });
    const occurrence = await prisma.worldEventOccurrence.findFirstOrThrow({
      where: { eventKey: 'crownfall-market-day', startCycle: 100_000 },
    });
    expect(occurrence.name).toBe('Market Day');
  });
});
