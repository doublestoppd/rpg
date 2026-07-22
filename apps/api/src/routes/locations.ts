import {
  currentLocationResponseSchema,
  locationFeaturesResponseSchema,
  travelDestinationsResponseSchema,
  worldMapResponseSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { LocationService } from '../domain/location/location-service.js';

interface LocationRouteOptions {
  locationService: LocationService;
}

export async function locationRoutes(
  app: FastifyInstance,
  opts: LocationRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { locationService } = opts;

  typed.get(
    '/locations/current',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['locations'],
        summary: "The character's current location",
        response: { 200: currentLocationResponseSchema },
      },
    },
    async (request) => locationService.getCurrentLocation(request.currentUser!.id),
  );

  typed.get(
    '/locations/current/features',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['locations'],
        summary: 'Local features available at the current location',
        response: { 200: locationFeaturesResponseSchema },
      },
    },
    async (request) => locationService.getCurrentFeatures(request.currentUser!.id),
  );

  typed.get(
    '/travel/destinations',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['travel'],
        summary: 'Directly connected destinations from the current location',
        response: { 200: travelDestinationsResponseSchema },
      },
    },
    async (request) => locationService.getDestinations(request.currentUser!.id),
  );

  typed.get(
    '/world/map',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['locations'],
        summary: 'The whole world topology and the caller’s current location',
        response: { 200: worldMapResponseSchema },
      },
    },
    async (request) => locationService.getWorldMap(request.currentUser!.id),
  );
}
