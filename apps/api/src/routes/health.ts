import { healthResponseSchema } from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

interface HealthRouteOptions {
  pingDatabase: () => Promise<void>;
}

export async function healthRoutes(app: FastifyInstance, opts: HealthRouteOptions): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: {
        tags: ['system'],
        summary: 'API and database health',
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
      },
    },
    async (request, reply) => {
      let databaseOk = true;
      try {
        await opts.pingDatabase();
      } catch (error) {
        databaseOk = false;
        request.log.warn({ err: error }, 'database health check failed');
      }

      const body = {
        status: databaseOk ? ('ok' as const) : ('degraded' as const),
        api: 'ok' as const,
        database: databaseOk ? ('ok' as const) : ('unreachable' as const),
        timestamp: new Date().toISOString(),
      };
      return reply.status(databaseOk ? 200 : 503).send(body);
    },
  );
}
