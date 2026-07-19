import { healthResponseSchema, livenessResponseSchema, readinessResponseSchema } from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

interface HealthRouteOptions {
  pingDatabase: () => Promise<void>;
  /** Verifies the expected migrations are applied (for readiness). */
  checkMigrations?: () => Promise<'ok' | 'pending' | 'unknown'>;
  /** Build/commit identifier surfaced in liveness/readiness. */
  version: string;
}

export async function healthRoutes(app: FastifyInstance, opts: HealthRouteOptions): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const version = opts.version;

  // Backward-compatible combined health (unchanged contract).
  typed.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        summary: 'API and database health',
        response: { 200: healthResponseSchema, 503: healthResponseSchema },
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
      return reply.status(databaseOk ? 200 : 503).send({
        status: databaseOk ? ('ok' as const) : ('degraded' as const),
        api: 'ok' as const,
        database: databaseOk ? ('ok' as const) : ('unreachable' as const),
        timestamp: new Date().toISOString(),
      });
    },
  );

  // Liveness: process is up. Never touches the database, so a database outage
  // does not cause an orchestrator to restart a healthy API.
  typed.get(
    '/health/live',
    {
      schema: {
        tags: ['system'],
        summary: 'Liveness — process is up (no database dependency)',
        response: { 200: livenessResponseSchema },
      },
    },
    async () => ({ status: 'alive' as const, version, timestamp: new Date().toISOString() }),
  );

  // Readiness: can serve traffic — database reachable and migrations applied.
  typed.get(
    '/health/ready',
    {
      schema: {
        tags: ['system'],
        summary: 'Readiness — database reachable and migrations applied',
        response: { 200: readinessResponseSchema, 503: readinessResponseSchema },
      },
    },
    async (request, reply) => {
      let databaseOk = true;
      try {
        await opts.pingDatabase();
      } catch (error) {
        databaseOk = false;
        request.log.warn({ err: error }, 'readiness database check failed');
      }
      let migrations: 'ok' | 'pending' | 'unknown' = 'unknown';
      if (databaseOk && opts.checkMigrations) {
        try {
          migrations = await opts.checkMigrations();
        } catch {
          migrations = 'unknown';
        }
      }
      const ready = databaseOk && migrations === 'ok';
      return reply.status(ready ? 200 : 503).send({
        status: ready ? ('ready' as const) : ('not_ready' as const),
        database: databaseOk ? ('ok' as const) : ('unreachable' as const),
        migrations,
        version,
        timestamp: new Date().toISOString(),
      });
    },
  );
}
