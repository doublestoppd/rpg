import { collectionsResponseSchema, donateRequestSchema, donateResponseSchema } from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { MuseumService } from '../domain/museum/museum-service.js';

interface MuseumRouteOptions {
  museumService: MuseumService;
}

export async function museumRoutes(app: FastifyInstance, opts: MuseumRouteOptions): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { museumService } = opts;

  typed.get(
    '/collections',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['museum'],
        summary: 'Museum collections with this character donation progress',
        response: { 200: collectionsResponseSchema },
      },
    },
    async (request) => museumService.getCollections(request.currentUser!.id),
  );

  typed.post(
    '/collections/:id/donations',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['museum'],
        summary: 'Donate an eligible artifact (atomic, first copy only, irreversible)',
        params: z.object({ id: z.uuid() }),
        body: donateRequestSchema,
        response: { 200: donateResponseSchema },
      },
    },
    async (request) =>
      museumService.donate(request.currentUser!.id, request.params.id, request.body),
  );
}
