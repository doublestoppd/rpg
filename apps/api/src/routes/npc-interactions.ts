import {
  chooseRequestSchema,
  npcInteractionResponseSchema,
  startInteractionRequestSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { InteractionService } from '../domain/living-world/interaction-service.js';

interface InteractionRouteOptions {
  interactionService: InteractionService;
}

/**
 * NPC dialogue interaction endpoints (Phase 26). Starting requires the NPC to be
 * present at the character's current location and segment; every choice is
 * authorized, version-checked (409 on stale), idempotent on replay, and applies
 * its typed effects atomically through the owning domain services.
 */
export async function npcInteractionRoutes(
  app: FastifyInstance,
  opts: InteractionRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { interactionService } = opts;
  const idParam = z.object({ id: z.uuid() });

  typed.post(
    '/npcs/:npcKey/interactions',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['world'],
        summary: 'Start a conversation with a present NPC',
        params: z.object({ npcKey: z.string().min(1).max(200) }),
        body: startInteractionRequestSchema,
        response: { 200: npcInteractionResponseSchema },
      },
    },
    async (request) =>
      interactionService.start(
        request.currentUser!.id,
        request.params.npcKey,
        request.body.idempotencyKey,
      ),
  );

  typed.get(
    '/npc-interactions/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['world'],
        summary: 'The current state of an NPC interaction the caller owns',
        params: idParam,
        response: { 200: npcInteractionResponseSchema },
      },
    },
    async (request) => interactionService.get(request.currentUser!.id, request.params.id),
  );

  typed.post(
    '/npc-interactions/:id/choices',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['world'],
        summary: 'Make a dialogue choice (expected-version + idempotency-key guarded)',
        params: idParam,
        body: chooseRequestSchema,
        response: { 200: npcInteractionResponseSchema },
      },
    },
    async (request) =>
      interactionService.choose(request.currentUser!.id, request.params.id, request.body),
  );

  typed.post(
    '/npc-interactions/:id/close',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['world'],
        summary: 'End an NPC interaction',
        params: idParam,
        response: { 200: npcInteractionResponseSchema },
      },
    },
    async (request) => interactionService.close(request.currentUser!.id, request.params.id),
  );
}
