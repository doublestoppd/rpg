import { claimQuestResponseSchema, questsResponseSchema, questViewSchema } from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { QuestService } from '../domain/quest/quest-service.js';

interface QuestRouteOptions {
  questService: QuestService;
}

export async function questRoutes(app: FastifyInstance, opts: QuestRouteOptions): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { questService } = opts;

  typed.get(
    '/quests',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['quests'],
        summary: 'All quests with this character state and progress',
        response: { 200: questsResponseSchema },
      },
    },
    async (request) => questService.getQuests(request.currentUser!.id),
  );

  typed.post(
    '/quests/:id/accept',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['quests'],
        summary: 'Accept a quest (progress starts only from acceptance)',
        params: z.object({ id: z.uuid() }),
        response: { 200: questViewSchema },
      },
    },
    async (request) => questService.accept(request.currentUser!.id, request.params.id),
  );

  typed.post(
    '/quests/:id/claim',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['quests'],
        summary: 'Claim rewards for a completed quest (exactly once)',
        params: z.object({ id: z.uuid() }),
        response: { 200: claimQuestResponseSchema },
      },
    },
    async (request) => questService.claim(request.currentUser!.id, request.params.id),
  );
}
