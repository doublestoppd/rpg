import type { PrismaClient } from '@prisma/client';
import type { WorldTimeResponse } from '@rpg/shared';

import {
  DEFAULT_WORLD_TIME_CONFIG,
  worldTimeConfigSchema,
  type WorldTimeConfigValue,
} from '../../config/world.js';

/**
 * Server-authoritative world clock (Phase 26). The current cycle and segment
 * are DERIVED from server time against the active configuration — never stored
 * per row and never dependent on a worker. Every function takes an injected
 * `now` so tests drive time deterministically; domain code must pass a single
 * `now` per request rather than calling `Date.now()` in several places.
 */

/** The cycle identifier for an instant: a monotonic, timestamp-authoritative id. */
export function cycleIdAt(config: WorldTimeConfigValue, now: Date): string {
  const epochSeconds = Math.floor(now.getTime() / 1000);
  return `C${Math.floor(epochSeconds / config.cycleLengthSeconds)}`;
}

/**
 * Pure derivation of the world time at `now` from a config. Segments are sorted
 * ascending by `startBps`; the active segment is the last whose boundary the
 * cycle position has passed.
 */
export function computeWorldTime(config: WorldTimeConfigValue, now: Date): WorldTimeResponse {
  const cycleLengthMs = config.cycleLengthSeconds * 1000;
  const nowMs = now.getTime();
  const cycleNumber = Math.floor(nowMs / cycleLengthMs);
  const cycleStartMs = cycleNumber * cycleLengthMs;
  const positionBps = Math.floor(((nowMs - cycleStartMs) / cycleLengthMs) * 10_000);

  const segments = [...config.segments].sort((a, b) => a.startBps - b.startBps);
  let activeIndex = 0;
  for (let i = 0; i < segments.length; i++) {
    if (positionBps >= segments[i]!.startBps) activeIndex = i;
  }
  const active = segments[activeIndex]!;
  const nextStartBps =
    activeIndex + 1 < segments.length ? segments[activeIndex + 1]!.startBps : 10_000;

  const bpsToMs = (bps: number) => cycleStartMs + Math.round((bps / 10_000) * cycleLengthMs);
  const iso = (ms: number) => new Date(ms).toISOString();

  return {
    cycleId: `C${cycleNumber}`,
    segment: active.segment,
    cycleLengthSeconds: config.cycleLengthSeconds,
    segmentStartsAt: iso(bpsToMs(active.startBps)),
    segmentEndsAt: iso(bpsToMs(nextStartBps)),
    cycleStartsAt: iso(cycleStartMs),
    cycleEndsAt: iso(cycleStartMs + cycleLengthMs),
    configRevision: config.revision,
    segments: segments.map((s) => ({
      segment: s.segment,
      startBps: s.startBps,
    })),
    serverTime: iso(nowMs),
  };
}

export interface WorldClockService {
  /** The active configuration (highest stored revision; default if unseeded). */
  activeConfig(): Promise<WorldTimeConfigValue>;
  /** The world time at `now` against the active configuration. */
  currentTime(now?: Date): Promise<WorldTimeResponse>;
  /** The cycle id at `now` against the active configuration. */
  currentCycleId(now?: Date): Promise<string>;
}

export function createWorldClockService(prisma: PrismaClient): WorldClockService {
  async function activeConfig(): Promise<WorldTimeConfigValue> {
    const row = await prisma.worldTimeConfig.findFirst({ orderBy: { revision: 'desc' } });
    if (!row) return DEFAULT_WORLD_TIME_CONFIG;
    return worldTimeConfigSchema.parse({
      revision: row.revision,
      cycleLengthSeconds: row.cycleLengthSeconds,
      segments: row.segments,
    });
  }

  return {
    activeConfig,
    async currentTime(now = new Date()) {
      return computeWorldTime(await activeConfig(), now);
    },
    async currentCycleId(now = new Date()) {
      return cycleIdAt(await activeConfig(), now);
    },
  };
}
