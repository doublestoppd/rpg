import { reforgeQuoteSchema, reforgeRequestSchema, reforgeResultSchema } from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { ReforgeService } from '../domain/reforge/reforge-service.js';

interface ReforgeRouteOptions {
  reforgeService: ReforgeService;
}

const quoteQuerySchema = z.object({ itemInstanceId: z.uuid() });

export async function reforgeRoutes(
  app: FastifyInstance,
  opts: ReforgeRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { reforgeService } = opts;

  typed.get(
    '/reforge/quote',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['reforge'],
        summary: 'Cost and eligibility to reforge an equipment instance',
        querystring: quoteQuerySchema,
        response: { 200: reforgeQuoteSchema },
      },
    },
    async (request) => reforgeService.quote(request.currentUser!.id, request.query.itemInstanceId),
  );

  typed.post(
    '/reforge',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['reforge'],
        summary: 'Reroll an equipment instance’s affixes for Gold (idempotent)',
        body: reforgeRequestSchema,
        response: { 200: reforgeResultSchema },
      },
    },
    async (request) => reforgeService.reforge(request.currentUser!.id, request.body),
  );
}
