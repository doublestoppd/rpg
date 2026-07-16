import { z } from 'zod';

import { locationSchema } from './location.js';

export const idempotencyKeySchema = z
  .string()
  .min(8, 'Idempotency key must be at least 8 characters')
  .max(64, 'Idempotency key must be at most 64 characters')
  .regex(/^[A-Za-z0-9_-]+$/, 'Idempotency key must be URL-safe');

export const travelStartRequestSchema = z.object({
  destinationSlug: z.string().min(1),
  idempotencyKey: idempotencyKeySchema,
});
export type TravelStartRequest = z.infer<typeof travelStartRequestSchema>;

export const travelStatusSchema = z.enum(['IN_PROGRESS', 'COMPLETED']);

export const travelStateSchema = z.object({
  id: z.uuid(),
  status: travelStatusSchema,
  origin: locationSchema,
  destination: locationSchema,
  startedAt: z.iso.datetime(),
  completesAt: z.iso.datetime(),
  /** Whole seconds until arrival; 0 when complete. */
  remainingSeconds: z.number().int().min(0),
});
export type TravelState = z.infer<typeof travelStateSchema>;

export const travelStatusResponseSchema = z.object({
  /** The in-progress travel, or null when the character is at a location. */
  active: travelStateSchema.nullable(),
});
export type TravelStatusResponse = z.infer<typeof travelStatusResponseSchema>;
