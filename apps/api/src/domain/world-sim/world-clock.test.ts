import { describe, expect, it } from 'vitest';

import { DEFAULT_WORLD_TIME_CONFIG } from '../../config/world.js';
import { computeWorldTime, cycleIdAt } from './world-clock.js';

/**
 * World-clock unit tests (Phase 26). Time is derived purely from an injected
 * clock, so segment boundaries and cycle ids are exercised without any real
 * time, worker, or database.
 */

const config = DEFAULT_WORLD_TIME_CONFIG; // 7200s cycle; DAWN/DAY/DUSK/NIGHT at 0/20/60/75%

/** An instant `positionBps` basis points into cycle number `cycle`. */
function at(cycle: number, positionBps: number): Date {
  const cycleMs = config.cycleLengthSeconds * 1000;
  return new Date(cycle * cycleMs + Math.floor((positionBps / 10_000) * cycleMs));
}

describe('world-clock segment derivation', () => {
  it('maps each cycle position to the correct segment', () => {
    expect(computeWorldTime(config, at(10, 0)).segment).toBe('DAWN');
    expect(computeWorldTime(config, at(10, 1999)).segment).toBe('DAWN');
    expect(computeWorldTime(config, at(10, 2000)).segment).toBe('DAY');
    expect(computeWorldTime(config, at(10, 5999)).segment).toBe('DAY');
    expect(computeWorldTime(config, at(10, 6000)).segment).toBe('DUSK');
    expect(computeWorldTime(config, at(10, 7499)).segment).toBe('DUSK');
    expect(computeWorldTime(config, at(10, 7500)).segment).toBe('NIGHT');
    expect(computeWorldTime(config, at(10, 9999)).segment).toBe('NIGHT');
  });

  it('reports segment and cycle boundaries that bracket the current instant', () => {
    const t = computeWorldTime(config, at(10, 3000)); // mid-DAY
    const now = at(10, 3000).getTime();
    expect(new Date(t.segmentStartsAt).getTime()).toBeLessThanOrEqual(now);
    expect(new Date(t.segmentEndsAt).getTime()).toBeGreaterThan(now);
    expect(new Date(t.cycleStartsAt).getTime()).toBeLessThanOrEqual(now);
    expect(new Date(t.cycleEndsAt).getTime()).toBeGreaterThan(now);
    // DAY runs 20%..60% of a 7200s cycle → a 2880s-long segment.
    const segmentSeconds =
      (new Date(t.segmentEndsAt).getTime() - new Date(t.segmentStartsAt).getTime()) / 1000;
    expect(segmentSeconds).toBe(2880);
  });

  it('produces a monotonic cycle id that advances exactly at the boundary', () => {
    expect(cycleIdAt(config, at(41, 9999))).toBe('C41');
    expect(cycleIdAt(config, at(42, 0))).toBe('C42');
    expect(computeWorldTime(config, at(42, 0)).cycleId).toBe('C42');
  });
});
