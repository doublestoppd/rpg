import {
  claimCraftingResponseSchema,
  craftingRecipesResponseSchema,
  craftingRunSchema,
  craftingStatusResponseSchema,
  startCraftingRequestSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { CraftingService } from '../domain/crafting/crafting-service.js';

interface CraftingRouteOptions {
  craftingService: CraftingService;
}

export async function craftingRoutes(
  app: FastifyInstance,
  opts: CraftingRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { craftingService } = opts;

  typed.get(
    '/crafting/recipes',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['crafting'],
        summary: 'Recipes at the current location + profession progress',
        response: { 200: craftingRecipesResponseSchema },
      },
    },
    async (request) => craftingService.getRecipes(request.currentUser!.id),
  );

  typed.post(
    '/crafting/start',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['crafting'],
        summary: 'Start a timed run (inputs + Gold consumed atomically, once)',
        body: startCraftingRequestSchema,
        response: { 200: craftingRunSchema },
      },
    },
    async (request) => craftingService.start(request.currentUser!.id, request.body),
  );

  typed.get(
    '/crafting/status',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['crafting'],
        summary: 'Crafting state after lazy finalization',
        response: { 200: craftingStatusResponseSchema },
      },
    },
    async (request) => craftingService.status(request.currentUser!.id),
  );

  typed.post(
    '/crafting/claim',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['crafting'],
        summary: 'Collect a capacity-held output (exactly once)',
        response: { 200: claimCraftingResponseSchema },
      },
    },
    async (request) => craftingService.claim(request.currentUser!.id),
  );
}
