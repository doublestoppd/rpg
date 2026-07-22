import {
  activityResponseSchema,
  sceneResponseSchema,
  worldEventsResponseSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { ActivityService } from '../domain/living-world/activity-service.js';
import type { SceneService } from '../domain/living-world/scene-service.js';
import type { WorldEventService } from '../domain/living-world/world-event-service.js';

interface SceneRouteOptions {
  sceneService: SceneService;
  worldEventService: WorldEventService;
  activityService: ActivityService;
}

/**
 * World events, local activity, and the coherent current-scene read model
 * (Phase 26, increment 4). All reads; events are lazily finalized on read, so
 * everything here stays correct with the worker stopped.
 */
export async function sceneRoutes(app: FastifyInstance, opts: SceneRouteOptions): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { sceneService, worldEventService, activityService } = opts;

  typed.get(
    '/world/events',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['world'],
        summary: "Active world events in the character's current region",
        response: { 200: worldEventsResponseSchema },
      },
    },
    async (request) => worldEventService.eventsForCurrentLocation(request.currentUser!.id),
  );

  typed.get(
    '/locations/current/activity',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['world'],
        summary: 'A bounded, privacy-safe recent-activity feed for the current location',
        response: { 200: activityResponseSchema },
      },
    },
    async (request) => activityService.forCurrentLocation(request.currentUser!.id),
  );

  typed.get(
    '/locations/current/scene',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['world'],
        summary: 'The coherent current-scene read model (one request, whole scene)',
        response: { 200: sceneResponseSchema },
      },
    },
    async (request) => sceneService.currentScene(request.currentUser!.id),
  );
}
