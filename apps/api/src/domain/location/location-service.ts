import type { Location, PrismaClient } from '@prisma/client';
import type {
  CurrentLocationResponse,
  LocationFeaturesResponse,
  LocationInfo,
  TravelDestinationsResponse,
} from '@rpg/shared';

import { DomainError } from '../../lib/http-errors.js';
import type { CharacterService } from '../character/character-service.js';

export const STARTING_LOCATION_SLUG = 'crownfall-city';

export function toLocationInfo(location: Location): LocationInfo {
  return {
    id: location.id,
    slug: location.slug,
    name: location.name,
    region: location.region,
    description: location.description,
    artworkKey: location.artworkKey,
    isSafe: location.isSafe,
  };
}

export interface LocationService {
  /**
   * Resolves the character's current location, lazily assigning the starting
   * location to characters created before the world existed.
   */
  getCurrentLocation(userId: string): Promise<CurrentLocationResponse>;
  getCurrentFeatures(userId: string): Promise<LocationFeaturesResponse>;
  /** Only directly connected destinations are ever returned. */
  getDestinations(userId: string): Promise<TravelDestinationsResponse>;
  /** The character's current location id (with lazy backfill). */
  requireCurrentLocationId(userId: string): Promise<string>;
}

export function createLocationService(
  prisma: PrismaClient,
  characterService: CharacterService,
): LocationService {
  async function resolveCurrentLocation(userId: string): Promise<Location> {
    const character = await characterService.requireCharacter(userId);
    if (character.currentLocationId) {
      const location = await prisma.location.findUnique({
        where: { id: character.currentLocationId },
      });
      if (location) return location;
    }
    // Lazy backfill: place the character at the starting location.
    const starting = await prisma.location.findUnique({
      where: { slug: STARTING_LOCATION_SLUG },
    });
    if (!starting) {
      throw new DomainError(500, 'WORLD_NOT_SEEDED', 'World locations are not seeded.');
    }
    await prisma.character.update({
      where: { id: character.id },
      data: { currentLocationId: starting.id },
    });
    return starting;
  }

  return {
    async getCurrentLocation(userId) {
      const location = await resolveCurrentLocation(userId);
      return { location: toLocationInfo(location) };
    },

    async getCurrentFeatures(userId) {
      const location = await resolveCurrentLocation(userId);
      const features = await prisma.locationFeature.findMany({
        where: { locationId: location.id },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      return {
        features: features.map((f) => ({
          id: f.id,
          type: f.type,
          name: f.name,
          description: f.description,
        })),
      };
    },

    async getDestinations(userId) {
      const location = await resolveCurrentLocation(userId);
      const routes = await prisma.travelRoute.findMany({
        where: { fromLocationId: location.id },
        include: { toLocation: true },
        orderBy: { travelSeconds: 'asc' },
      });
      return {
        destinations: routes.map((route) => ({
          location: toLocationInfo(route.toLocation),
          travelSeconds: route.travelSeconds,
          goldCost: route.goldCost.toString(),
        })),
      };
    },

    async requireCurrentLocationId(userId) {
      const location = await resolveCurrentLocation(userId);
      return location.id;
    },
  };
}
