import type { Location, PrismaClient, TravelState as TravelStateRow } from '@prisma/client';
import type { TravelState, TravelStatusResponse } from '@rpg/shared';

import { conflict, DomainError } from '../../lib/http-errors.js';
import type { TimedStateFinalizer } from '../../lib/timed-state.js';
import type { CharacterService } from '../character/character-service.js';
import { toLocationInfo } from '../location/location-service.js';
import { noopQuestEvents, type QuestEventSink } from '../quest/quest-events.js';

export const currentlyTraveling = () =>
  conflict('CURRENTLY_TRAVELING', 'You are on the road — local actions are unavailable.');

export interface TravelService {
  /** Timed-state finalizer: completes expired travel exactly once. */
  finalizer: TimedStateFinalizer;
  /**
   * Starts travel to a directly connected destination. Idempotent per
   * character + idempotencyKey: repeats return the existing state; a
   * different concurrent start returns 409.
   */
  start(
    userId: string,
    input: { destinationSlug: string; idempotencyKey: string },
  ): Promise<TravelState>;
  /** Current travel status after lazy finalization. */
  status(userId: string): Promise<TravelStatusResponse>;
  /** Throws 409 if the character has unexpired in-progress travel. */
  assertNotTraveling(characterId: string, now?: Date): Promise<void>;
}

export function createTravelService(
  prisma: PrismaClient,
  characterService: CharacterService,
  questEvents: QuestEventSink = noopQuestEvents,
): TravelService {
  async function toTravelState(
    row: TravelStateRow,
    locations: { origin: Location; destination: Location },
    now: Date,
  ): Promise<TravelState> {
    return {
      id: row.id,
      status: row.status,
      origin: toLocationInfo(locations.origin),
      destination: toLocationInfo(locations.destination),
      startedAt: row.startedAt.toISOString(),
      completesAt: row.completesAt.toISOString(),
      remainingSeconds:
        row.status === 'COMPLETED'
          ? 0
          : Math.max(0, Math.ceil((row.completesAt.getTime() - now.getTime()) / 1000)),
    };
  }

  async function loadLocations(row: TravelStateRow) {
    const [origin, destination] = await Promise.all([
      prisma.location.findUniqueOrThrow({ where: { id: row.originLocationId } }),
      prisma.location.findUniqueOrThrow({ where: { id: row.destinationLocationId } }),
    ]);
    return { origin, destination };
  }

  const finalizer: TimedStateFinalizer = {
    name: 'travel',
    async finalizeExpired(characterId, now) {
      const expired = await prisma.travelState.findFirst({
        where: { characterId, status: 'IN_PROGRESS', completesAt: { lte: now } },
      });
      if (!expired) return;
      await prisma.$transaction(async (tx) => {
        // Conditional update makes completion exactly-once under races.
        const updated = await tx.travelState.updateMany({
          where: { id: expired.id, status: 'IN_PROGRESS' },
          data: { status: 'COMPLETED', completedAt: now },
        });
        if (updated.count === 1) {
          await tx.character.update({
            where: { id: characterId },
            data: { currentLocationId: expired.destinationLocationId },
          });
          // Typed domain event in the same transaction as the arrival.
          const destination = await tx.location.findUnique({
            where: { id: expired.destinationLocationId },
            select: { slug: true },
          });
          if (destination) {
            await questEvents.handle(tx, characterId, {
              type: 'TRAVEL_COMPLETED',
              locationSlug: destination.slug,
            });
          }
        }
      });
    },
  };

  return {
    finalizer,

    async assertNotTraveling(characterId, now = new Date()) {
      await finalizer.finalizeExpired(characterId, now);
      const active = await prisma.travelState.findFirst({
        where: { characterId, status: 'IN_PROGRESS' },
      });
      if (active) throw currentlyTraveling();
    },

    async start(userId, input) {
      const now = new Date();
      const character = await characterService.requireCharacter(userId);
      await finalizer.finalizeExpired(character.id, now);

      // Same idempotency key: return the existing state (any status).
      const existingByKey = await prisma.travelState.findUnique({
        where: {
          characterId_idempotencyKey: {
            characterId: character.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existingByKey) {
        return toTravelState(existingByKey, await loadLocations(existingByKey), now);
      }

      // A different start while traveling is a conflict.
      const active = await prisma.travelState.findFirst({
        where: { characterId: character.id, status: 'IN_PROGRESS' },
      });
      if (active) throw currentlyTraveling();

      const fresh = await prisma.character.findUniqueOrThrow({
        where: { id: character.id },
        select: { currentLocationId: true },
      });
      if (!fresh.currentLocationId) {
        throw new DomainError(409, 'NO_LOCATION', 'Your location could not be determined.');
      }

      const destination = await prisma.location.findUnique({
        where: { slug: input.destinationSlug },
      });
      if (!destination) {
        throw new DomainError(400, 'NO_ROUTE', 'No road leads there from here.');
      }
      const route = await prisma.travelRoute.findUnique({
        where: {
          fromLocationId_toLocationId: {
            fromLocationId: fresh.currentLocationId,
            toLocationId: destination.id,
          },
        },
      });
      if (!route) {
        throw new DomainError(400, 'NO_ROUTE', 'No road leads there from here.');
      }
      if (route.goldCost !== 0n) {
        // Charging happens atomically with creation once the currency service
        // exists (Phase 8); until then all routes must be free.
        throw new DomainError(500, 'ROUTE_COST_UNSUPPORTED', 'Route costs are not active yet.');
      }

      try {
        // Any future costs (Gold, stamina) must be charged inside this same
        // transaction, atomically with travel creation.
        const created = await prisma.$transaction(async (tx) => {
          const row = await tx.travelState.create({
            data: {
              characterId: character.id,
              routeId: route.id,
              originLocationId: route.fromLocationId,
              destinationLocationId: route.toLocationId,
              startedAt: now,
              completesAt: new Date(now.getTime() + route.travelSeconds * 1000),
              idempotencyKey: input.idempotencyKey,
            },
          });
          // While traveling the character is at neither origin nor destination.
          await tx.character.update({
            where: { id: character.id },
            data: { currentLocationId: null },
          });
          return row;
        });
        return await toTravelState(created, await loadLocations(created), now);
      } catch (error) {
        // Partial unique index: another request won the race to start travel.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          throw currentlyTraveling();
        }
        throw error;
      }
    },

    async status(userId) {
      const now = new Date();
      const character = await characterService.requireCharacter(userId);
      await finalizer.finalizeExpired(character.id, now);
      const active = await prisma.travelState.findFirst({
        where: { characterId: character.id, status: 'IN_PROGRESS' },
      });
      if (!active) return { active: null };
      return { active: await toTravelState(active, await loadLocations(active), now) };
    },
  };
}
