import { atmosphereResponseSchema, worldTimeResponseSchema } from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { LocationService } from '../domain/location/location-service.js';
import type { AtmosphereService } from '../domain/world-sim/atmosphere-service.js';
import type { WorldClockService } from '../domain/world-sim/world-clock.js';

interface WorldSimRouteOptions {
  worldClock: WorldClockService;
  atmosphereService: AtmosphereService;
  locationService: LocationService;
}

/**
 * Living-world read endpoints (Phase 26): the server-authoritative world clock
 * and the current regional atmosphere. Both are worker-independent — atmosphere
 * is lazily finalized on read — and derive their authority from server time.
 */
export async function worldSimRoutes(
  app: FastifyInstance,
  opts: WorldSimRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { worldClock, atmosphereService, locationService } = opts;

  typed.get(
    '/world/time',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['world'],
        summary: 'The authoritative world clock: current cycle and time segment',
        response: { 200: worldTimeResponseSchema },
      },
    },
    async () => worldClock.currentTime(),
  );

  typed.get(
    '/world/atmosphere',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['world'],
        summary: "The current regional atmosphere for the character's location",
        response: { 200: atmosphereResponseSchema },
      },
    },
    async (request) => {
      const { location } = await locationService.getCurrentLocation(request.currentUser!.id);
      return atmosphereService.finalizeCurrent(location.region);
    },
  );
}
