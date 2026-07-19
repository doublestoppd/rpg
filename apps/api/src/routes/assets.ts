import { ASSET_MANIFEST, assetsResponseSchema } from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

/**
 * Visual asset manifest (Phase 21). Serves the bundled, checksummed asset
 * contract the client resolves against and the admin asset picker previews.
 * Public and static: the manifest is compiled-in data (no database, no binary
 * blobs), so this is a cacheable read.
 */
export async function assetRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/assets',
    {
      schema: {
        tags: ['assets'],
        summary: 'The bundled visual asset manifest (roles, defaults, checksums)',
        response: { 200: assetsResponseSchema },
      },
    },
    async (_request, reply) => {
      // The manifest only changes on deploy; allow shared caching.
      reply.header('cache-control', 'public, max-age=300');
      return ASSET_MANIFEST;
    },
  );
}
