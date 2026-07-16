import { z } from 'zod';

/** Public contract for GET /api/v1/health. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  api: z.literal('ok'),
  database: z.enum(['ok', 'unreachable']),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
