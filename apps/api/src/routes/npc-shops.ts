import {
  npcShopDetailResponseSchema,
  npcShopListResponseSchema,
  npcShopPurchaseRequestSchema,
  npcShopPurchaseResponseSchema,
  sellbackRequestSchema,
  sellbackResponseSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { NpcShopService } from '../domain/npc-shop/npc-shop-service.js';

interface NpcShopRouteOptions {
  npcShopService: NpcShopService;
}

export async function npcShopRoutes(
  app: FastifyInstance,
  opts: NpcShopRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { npcShopService } = opts;

  typed.get(
    '/npc-shops',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['npc-shops'],
        summary: 'NPC shops at the current location',
        response: { 200: npcShopListResponseSchema },
      },
    },
    async (request) => npcShopService.listLocalShops(request.currentUser!.id),
  );

  typed.get(
    '/npc-shops/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['npc-shops'],
        summary: 'Shop stock (approximate availability; restocks lazily)',
        params: z.object({ id: z.uuid() }),
        response: { 200: npcShopDetailResponseSchema },
      },
    },
    async (request) => npcShopService.getShopDetail(request.currentUser!.id, request.params.id),
  );

  typed.post(
    '/npc-shops/:id/purchases',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['npc-shops'],
        summary: 'Buy from a stock entry (atomic, race-safe, idempotent)',
        params: z.object({ id: z.uuid() }),
        body: npcShopPurchaseRequestSchema,
        response: { 200: npcShopPurchaseResponseSchema },
      },
    },
    async (request) =>
      npcShopService.purchase(request.currentUser!.id, request.params.id, request.body),
  );

  typed.post(
    '/npc-shops/:id/sales',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['npc-shops'],
        summary: 'Sell stackable items to the shop at its sellback rate (idempotent)',
        params: z.object({ id: z.uuid() }),
        body: sellbackRequestSchema,
        response: { 200: sellbackResponseSchema },
      },
    },
    async (request) =>
      npcShopService.sell(request.currentUser!.id, request.params.id, request.body),
  );
}
