import { z } from 'zod';

/** Public contract for GET /api/v1/health. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  api: z.literal('ok'),
  database: z.enum(['ok', 'unreachable']),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * Liveness (Phase 18): the process is up. Deliberately does NOT touch the
 * database, so a database outage never restarts a healthy API process.
 */
export const livenessResponseSchema = z.object({
  status: z.literal('alive'),
  version: z.string(),
  timestamp: z.iso.datetime(),
});
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;

/**
 * Readiness (Phase 18): the API can serve traffic — database reachable and the
 * expected migrations applied. Returns 503 when not ready.
 */
export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  database: z.enum(['ok', 'unreachable']),
  migrations: z.enum(['ok', 'pending', 'unknown']),
  version: z.string(),
  timestamp: z.iso.datetime(),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
