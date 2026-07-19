import { npcDetailResponseSchema, npcListResponseSchema } from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { NpcService } from '../domain/living-world/npc-service.js';

interface NpcRouteOptions {
  npcService: NpcService;
}

/**
 * Named-NPC read endpoints (Phase 26). Availability is server-authoritative:
 * only NPCs whose published schedule places them at the character's current
 * location during the current world segment are returned.
 */
export async function npcRoutes(app: FastifyInstance, opts: NpcRouteOptions): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { npcService } = opts;

  typed.get(
    '/locations/current/npcs',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['world'],
        summary: 'NPCs present at the current location during the current world segment',
        response: { 200: npcListResponseSchema },
      },
    },
    async (request) => npcService.listAtCurrentLocation(request.currentUser!.id),
  );

  typed.get(
    '/npcs/:npcKey',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['world'],
        summary: 'A named NPC, with its availability for the requesting character',
        params: z.object({ npcKey: z.string().min(1).max(200) }),
        response: { 200: npcDetailResponseSchema },
      },
    },
    async (request) => npcService.getNpc(request.currentUser!.id, request.params.npcKey),
  );
}
