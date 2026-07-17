import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Structured audit logging for authoritative mutations (Phase 13B). Every
 * state-changing request logs one structured entry with the request id,
 * account, operation (the route pattern, never raw params), idempotency key,
 * duration, and outcome. Request bodies are never logged — only the
 * idempotency key is lifted out, so passwords and tokens cannot leak here.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Pulls the idempotency key (and nothing else) out of a request body. */
export function extractIdempotencyKey(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)['idempotencyKey'];
  return typeof value === 'string' ? value : null;
}

/** The onResponse hook body, exported for direct unit testing. */
export function auditMutation(request: FastifyRequest, reply: FastifyReply): void {
  if (!MUTATING_METHODS.has(request.method)) return;
  request.log.info(
    {
      audit: true,
      requestId: request.id,
      operation: `${request.method} ${request.routeOptions.url ?? request.url}`,
      accountId: request.currentUser?.id ?? null,
      idempotencyKey: extractIdempotencyKey(request.body),
      durationMs: Math.round(reply.elapsedTime),
      statusCode: reply.statusCode,
      success: reply.statusCode < 400,
    },
    'authoritative mutation',
  );
}

export function registerMutationAudit(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    auditMutation(request, reply);
  });
}
