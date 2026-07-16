import {
  travelStartRequestSchema,
  travelStateSchema,
  travelStatusResponseSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { TravelService } from '../domain/travel/travel-service.js';

interface TravelRouteOptions {
  travelService: TravelService;
}

export async function travelRoutes(app: FastifyInstance, opts: TravelRouteOptions): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { travelService } = opts;

  typed.post(
    '/travel/start',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['travel'],
        summary: 'Start traveling to a directly connected destination',
        body: travelStartRequestSchema,
        response: { 200: travelStateSchema },
      },
    },
    async (request) => travelService.start(request.currentUser!.id, request.body),
  );

  typed.get(
    '/travel/status',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['travel'],
        summary: 'Current travel status (lazily finalizes expired travel)',
        response: { 200: travelStatusResponseSchema },
      },
    },
    async (request) => travelService.status(request.currentUser!.id),
  );
}
