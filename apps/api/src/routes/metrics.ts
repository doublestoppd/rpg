import type { FastifyInstance } from 'fastify';

import { metrics } from '../lib/metrics.js';

interface MetricsRouteOptions {
  /** When unset the endpoint is disabled (metrics stay network-private). */
  metricsToken?: string | undefined;
}

/**
 * OpenMetrics-compatible export of the Phase 13B process counters (Phase 18).
 * These are resettable operational telemetry — never economy truth (that lives
 * in the admin database-derived endpoints). The metric name set is fixed and
 * carries NO user-supplied labels, so no user id, item slug, message body, or
 * reason can ever leak here. The endpoint is guarded by a bearer token and is
 * absent from the OpenAPI contract; leave METRICS_TOKEN unset to disable it.
 */
export async function metricsRoutes(
  app: FastifyInstance,
  opts: MetricsRouteOptions,
): Promise<void> {
  const token = opts.metricsToken;

  app.get('/metrics', { schema: { hide: true } }, async (request, reply) => {
    if (!token) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Resource not found.', requestId: request.id },
      });
    }
    const header = request.headers.authorization;
    if (header !== `Bearer ${token}`) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.', requestId: request.id },
      });
    }
    const snapshot = metrics.snapshot();
    const lines: string[] = [];
    for (const [name, value] of Object.entries(snapshot)) {
      const metricName = `rpg_${name}_total`;
      lines.push(`# TYPE ${metricName} counter`);
      lines.push(`${metricName} ${value}`);
    }
    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(`${lines.join('\n')}\n`);
  });
}
