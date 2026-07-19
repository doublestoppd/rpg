import { z } from 'zod';

/**
 * Living-world contracts (Phase 26): the server-authoritative world clock and
 * regional atmosphere. Both are derived/finalized server-side; clients may
 * animate locally but must reconcile with these responses.
 */

export const worldTimeSegmentSchema = z.enum(['DAWN', 'DAY', 'DUSK', 'NIGHT']);
export type WorldTimeSegment = z.infer<typeof worldTimeSegmentSchema>;

export const worldSegmentBoundarySchema = z.object({
  segment: worldTimeSegmentSchema,
  startBps: z.number().int().min(0).max(9999),
});

export const worldTimeResponseSchema = z.object({
  /** Monotonic identifier of the current cycle (timestamp-authoritative). */
  cycleId: z.string(),
  segment: worldTimeSegmentSchema,
  cycleLengthSeconds: z.number().int().min(1),
  /** ISO timestamps bounding the current segment and cycle. */
  segmentStartsAt: z.string(),
  segmentEndsAt: z.string(),
  cycleStartsAt: z.string(),
  cycleEndsAt: z.string(),
  /** Active world-time configuration revision. */
  configRevision: z.number().int().min(1),
  /** The full segment layout, for clients that animate the clock locally. */
  segments: z.array(worldSegmentBoundarySchema),
  /** Authoritative server time, for client reconciliation. */
  serverTime: z.string(),
});
export type WorldTimeResponse = z.infer<typeof worldTimeResponseSchema>;

// --- atmosphere ------------------------------------------------------------

export const weatherTypeSchema = z.enum(['CLEAR', 'CLOUDY', 'RAIN', 'FOG', 'STORM', 'SNOW']);
export type WeatherType = z.infer<typeof weatherTypeSchema>;

export const atmosphereIntensitySchema = z.enum(['CALM', 'MODERATE', 'STRONG']);
export const atmosphereVisibilitySchema = z.enum(['CLEAR', 'REDUCED', 'POOR']);
export const atmosphereTemperatureSchema = z.enum(['COLD', 'MILD', 'WARM', 'HOT']);
export const atmosphereWindSchema = z.enum(['STILL', 'BREEZY', 'GUSTY']);
export const atmosphereCrowdSchema = z.enum(['DESERTED', 'QUIET', 'MODERATE', 'BUSY']);

export const atmosphereResponseSchema = z.object({
  region: z.string(),
  cycleId: z.string(),
  weather: weatherTypeSchema,
  intensity: atmosphereIntensitySchema,
  visibility: atmosphereVisibilitySchema,
  temperature: atmosphereTemperatureSchema,
  wind: atmosphereWindSchema,
  crowdLevel: atmosphereCrowdSchema,
  descriptionKey: z.string().nullable(),
  startsAt: z.string(),
  expiresAt: z.string(),
  configRevision: z.number().int().min(1),
});
export type AtmosphereResponse = z.infer<typeof atmosphereResponseSchema>;
