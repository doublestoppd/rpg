import type { PrismaClient, WorldEventDefinition, WorldEventOccurrence } from '@prisma/client';
import type { WorldEventInfo, WorldEventsResponse } from '@rpg/shared';

import type { WorldTimeConfigValue } from '../../config/world.js';
import { metrics } from '../../lib/metrics.js';
import type { LocationService } from '../location/location-service.js';
import type { WorldClockService } from '../world-sim/world-clock.js';

/**
 * World events (Phase 26, increment 4). Recurrence is a pure function of the
 * world-cycle number — occurs in cycles where (cycle - offset) % every == 0,
 * lasting `durationCycles` — so no scheduler state exists to go stale.
 * Occurrences are persisted idempotently (unique eventKey + startCycle) with
 * the definition's effects SNAPSHOTTED in: a later revision publish never
 * mutates an active occurrence, and lazy finalization works with the worker
 * stopped. Start and expiry are timestamp-authoritative (startsAt/endsAt).
 */

/** The active occurrence window for a definition at cycle `c`, if any. */
export function occurrenceWindowAt(
  def: Pick<WorldEventDefinition, 'everyCycles' | 'offsetCycles' | 'durationCycles'>,
  cycle: number,
): { startCycle: number } | null {
  const every = Math.max(1, def.everyCycles);
  const rem = (((cycle - def.offsetCycles) % every) + every) % every;
  const startCycle = cycle - rem;
  if (startCycle < 0) return null;
  return cycle < startCycle + def.durationCycles ? { startCycle } : null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

function toInfo(row: WorldEventOccurrence): WorldEventInfo {
  return {
    key: row.eventKey,
    name: row.name,
    description: row.description,
    eventType: row.eventType as WorldEventInfo['eventType'],
    region: row.region,
    locationSlug: row.locationSlug,
    priority: row.priority,
    sceneDescriptionKey: row.sceneDescriptionKey,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  };
}

export interface WorldEventService {
  /** Idempotently finalizes and returns the events active in a region now. */
  activeEvents(region: string, now?: Date): Promise<WorldEventInfo[]>;
  /** The active events for the character's current region. */
  eventsForCurrentLocation(userId: string, now?: Date): Promise<WorldEventsResponse>;
}

export function createWorldEventService(
  prisma: PrismaClient,
  worldClock: WorldClockService,
  locationService: LocationService,
): WorldEventService {
  async function finalizeDue(
    config: WorldTimeConfigValue,
    region: string,
    now: Date,
  ): Promise<void> {
    const cycleLengthMs = config.cycleLengthSeconds * 1000;
    const cycle = Math.floor(now.getTime() / cycleLengthMs);

    const definitions = await prisma.worldEventDefinition.findMany({
      where: { region, status: 'PUBLISHED' },
    });
    for (const def of definitions) {
      const window = occurrenceWindowAt(def, cycle);
      if (!window) continue;
      const exists = await prisma.worldEventOccurrence.findUnique({
        where: { eventKey_startCycle: { eventKey: def.key, startCycle: window.startCycle } },
      });
      if (exists) continue;
      try {
        await prisma.worldEventOccurrence.create({
          data: {
            eventKey: def.key,
            revision: def.revision,
            startCycle: window.startCycle,
            // Snapshot the effects: a later revision never mutates this row.
            name: def.name,
            description: def.description,
            eventType: def.eventType,
            region: def.region,
            locationSlug: def.locationSlug,
            priority: def.priority,
            sceneDescriptionKey: def.sceneDescriptionKey,
            startsAt: new Date(window.startCycle * cycleLengthMs),
            endsAt: new Date((window.startCycle + def.durationCycles) * cycleLengthMs),
          },
        });
        metrics.increment('world_event_lazy_finalization');
      } catch (error) {
        if (isUniqueViolation(error)) {
          // A concurrent request created the same occurrence first — same row.
          metrics.increment('world_event_occurrence_conflict');
          continue;
        }
        throw error;
      }
    }
  }

  return {
    async activeEvents(region, now = new Date()) {
      const config = await worldClock.activeConfig();
      await finalizeDue(config, region, now);
      const rows = await prisma.worldEventOccurrence.findMany({
        where: { region, startsAt: { lte: now }, endsAt: { gt: now } },
        orderBy: [{ priority: 'desc' }, { startsAt: 'asc' }],
      });
      return rows.map(toInfo);
    },

    async eventsForCurrentLocation(userId, now = new Date()) {
      const { location } = await locationService.getCurrentLocation(userId);
      const events = await this.activeEvents(location.region, now);
      return { region: location.region, events };
    },
  };
}
