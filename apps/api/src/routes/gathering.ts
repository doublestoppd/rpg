import {
  claimGatheringResponseSchema,
  gatheringActionsResponseSchema,
  gatheringRunSchema,
  gatheringStatusResponseSchema,
  startGatheringRequestSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { GatheringService } from '../domain/gathering/gathering-service.js';

interface GatheringRouteOptions {
  gatheringService: GatheringService;
}

export async function gatheringRoutes(
  app: FastifyInstance,
  opts: GatheringRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { gatheringService } = opts;

  typed.get(
    '/gathering/actions',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['gathering'],
        summary: 'Gathering actions at the current location + skill progress',
        response: { 200: gatheringActionsResponseSchema },
      },
    },
    async (request) => gatheringService.getActions(request.currentUser!.id),
  );

  typed.post(
    '/gathering/start',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['gathering'],
        summary: 'Start a timed run (reward pre-rolled server-side, never exposed)',
        body: startGatheringRequestSchema,
        response: { 200: gatheringRunSchema },
      },
    },
    async (request) => gatheringService.start(request.currentUser!.id, request.body),
  );

  typed.get(
    '/gathering/status',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['gathering'],
        summary: 'Gathering state after lazy finalization',
        response: { 200: gatheringStatusResponseSchema },
      },
    },
    async (request) => gatheringService.status(request.currentUser!.id),
  );

  typed.post(
    '/gathering/claim',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['gathering'],
        summary: 'Place a capacity-held reward into inventory (exactly once)',
        response: { 200: claimGatheringResponseSchema },
      },
    },
    async (request) => gatheringService.claim(request.currentUser!.id),
  );
}
