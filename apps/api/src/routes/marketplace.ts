import {
  createListingRequestSchema,
  createPlayerShopRequestSchema,
  deliveriesResponseSchema,
  listingsQuerySchema,
  marketplaceListingsResponseSchema,
  marketSummarySchema,
  okResponseSchema,
  playerShopSchema,
  purchaseListingRequestSchema,
  purchaseListingResponseSchema,
  regionsResponseSchema,
  updatePlayerShopRequestSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { MarketplaceService } from '../domain/marketplace/marketplace-service.js';

interface MarketplaceRouteOptions {
  marketplaceService: MarketplaceService;
}

export async function marketplaceRoutes(
  app: FastifyInstance,
  opts: MarketplaceRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { marketplaceService } = opts;
  const idParams = z.object({ id: z.uuid() });

  typed.post(
    '/player-shops',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['marketplace'],
        summary: 'Open your shop, registered to a region',
        body: createPlayerShopRequestSchema,
        response: { 201: playerShopSchema },
      },
    },
    async (request, reply) => {
      const shop = await marketplaceService.createShop(request.currentUser!.id, request.body);
      return reply.status(201).send(shop);
    },
  );

  typed.get(
    '/player-shops/me',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['marketplace'],
        summary: 'Your shop',
        response: { 200: playerShopSchema },
      },
    },
    async (request) => marketplaceService.getMyShop(request.currentUser!.id),
  );

  typed.patch(
    '/player-shops/me',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['marketplace'],
        summary: 'Update your shop name or description',
        body: updatePlayerShopRequestSchema,
        response: { 200: playerShopSchema },
      },
    },
    async (request) => marketplaceService.updateMyShop(request.currentUser!.id, request.body),
  );

  typed.get(
    '/marketplace/regions',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['marketplace'],
        summary: 'Regions a shop may register to',
        response: { 200: regionsResponseSchema },
      },
    },
    async () => marketplaceService.listRegions(),
  );

  typed.post(
    '/marketplace/listings',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['marketplace'],
        summary: 'List an asset for whole-listing sale (marketplace location only)',
        body: createListingRequestSchema,
        response: { 201: z.object({ listingId: z.uuid() }) },
      },
    },
    async (request, reply) => {
      const result = await marketplaceService.createListing(request.currentUser!.id, request.body);
      return reply.status(201).send(result);
    },
  );

  typed.delete(
    '/marketplace/listings/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['marketplace'],
        summary: 'Cancel your active listing (asset returns to inventory)',
        params: idParams,
        response: { 200: okResponseSchema },
      },
    },
    async (request) => {
      await marketplaceService.cancelListing(request.currentUser!.id, request.params.id);
      return { ok: true as const };
    },
  );

  typed.get(
    '/marketplace/listings',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['marketplace'],
        summary: 'Browse listings (any safe location)',
        querystring: listingsQuerySchema,
        response: { 200: marketplaceListingsResponseSchema },
      },
    },
    async (request) => marketplaceService.browseListings(request.currentUser!.id, request.query),
  );

  typed.post(
    '/marketplace/listings/:id/purchase',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['marketplace'],
        summary: 'Buy a whole listing (marketplace location only)',
        params: idParams,
        body: purchaseListingRequestSchema,
        response: { 200: purchaseListingResponseSchema },
      },
    },
    async (request) =>
      marketplaceService.purchaseListing(request.currentUser!.id, request.params.id, request.body),
  );

  typed.get(
    '/marketplace/items/:slug/summary',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['marketplace'],
        summary: 'Market summary for an item (median needs 5+ recent sales)',
        params: z.object({ slug: z.string().min(1) }),
        response: { 200: marketSummarySchema },
      },
    },
    async (request) =>
      marketplaceService.getItemSummary(request.currentUser!.id, request.params.slug),
  );

  typed.get(
    '/deliveries',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['marketplace'],
        summary: 'Your deliveries (lazily finalizes arrivals)',
        response: { 200: deliveriesResponseSchema },
      },
    },
    async (request) => marketplaceService.getDeliveries(request.currentUser!.id),
  );
}
