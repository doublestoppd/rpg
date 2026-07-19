import { z } from 'zod';

/**
 * Living-world configuration (Phase 26). World time is a data-driven cycle: the
 * active `WorldTimeConfig` row (highest revision) defines the cycle length and
 * the segment boundaries; the current segment is derived from server time, so a
 * config change never rewrites stored history. Atmosphere weight tables drive
 * deterministic, server-secret selection per (region, cycleId).
 *
 * These constants are the seeded defaults (revision 1). Publishing a new
 * world-time configuration revision is a later increment; the runtime already
 * reads the active revision from the database rather than these constants.
 */

export const WORLD_TIME_SEGMENTS = ['DAWN', 'DAY', 'DUSK', 'NIGHT'] as const;
export type WorldTimeSegment = (typeof WORLD_TIME_SEGMENTS)[number];

export const worldSegmentBoundarySchema = z.object({
  segment: z.enum(WORLD_TIME_SEGMENTS),
  /** Cycle position where this segment begins, in basis points [0, 10000). */
  startBps: z.number().int().min(0).max(9999),
});
export type WorldSegmentBoundary = z.infer<typeof worldSegmentBoundarySchema>;

export const worldTimeConfigSchema = z.object({
  revision: z.number().int().min(1),
  cycleLengthSeconds: z.number().int().min(60),
  segments: z.array(worldSegmentBoundarySchema).min(1),
});
export type WorldTimeConfigValue = z.infer<typeof worldTimeConfigSchema>;

/**
 * Default clock: a two-hour real-time cycle split into dawn/day/dusk/night.
 * Boundaries are fractions of the cycle so the same config works at any length.
 */
export const DEFAULT_WORLD_TIME_CONFIG: WorldTimeConfigValue = worldTimeConfigSchema.parse({
  revision: 1,
  cycleLengthSeconds: 7200,
  segments: [
    { segment: 'DAWN', startBps: 0 },
    { segment: 'DAY', startBps: 2000 },
    { segment: 'DUSK', startBps: 6000 },
    { segment: 'NIGHT', startBps: 7500 },
  ],
});

// --- atmosphere ------------------------------------------------------------

export const WEATHER_TYPES = ['CLEAR', 'CLOUDY', 'RAIN', 'FOG', 'STORM', 'SNOW'] as const;
export type WeatherType = (typeof WEATHER_TYPES)[number];

export const INTENSITY_LEVELS = ['CALM', 'MODERATE', 'STRONG'] as const;
export type IntensityLevel = (typeof INTENSITY_LEVELS)[number];

export const VISIBILITY_LEVELS = ['CLEAR', 'REDUCED', 'POOR'] as const;
export type VisibilityLevel = (typeof VISIBILITY_LEVELS)[number];

export const TEMPERATURE_LEVELS = ['COLD', 'MILD', 'WARM', 'HOT'] as const;
export type TemperatureLevel = (typeof TEMPERATURE_LEVELS)[number];

export const WIND_LEVELS = ['STILL', 'BREEZY', 'GUSTY'] as const;
export type WindLevel = (typeof WIND_LEVELS)[number];

export const CROWD_LEVELS = ['DESERTED', 'QUIET', 'MODERATE', 'BUSY'] as const;
export type CrowdLevel = (typeof CROWD_LEVELS)[number];

export interface WeightedOption<T extends string> {
  value: T;
  weight: number;
}

/** Baseline weather weights; regions may override to feel distinct. */
const DEFAULT_WEATHER_WEIGHTS: WeightedOption<WeatherType>[] = [
  { value: 'CLEAR', weight: 40 },
  { value: 'CLOUDY', weight: 28 },
  { value: 'RAIN', weight: 16 },
  { value: 'FOG', weight: 8 },
  { value: 'STORM', weight: 4 },
  { value: 'SNOW', weight: 4 },
];

/**
 * Per-region weather tables and a temperature baseline. Regions not listed use
 * the default table and a MILD baseline. Weights are relative, not required to
 * sum to any total.
 */
export interface RegionAtmosphereProfile {
  weather: WeightedOption<WeatherType>[];
  /** Baseline temperature before the night adjustment. */
  temperatureBaseline: TemperatureLevel;
}

export const REGION_ATMOSPHERE_PROFILES: Record<string, RegionAtmosphereProfile> = {
  Crownfall: {
    weather: DEFAULT_WEATHER_WEIGHTS,
    temperatureBaseline: 'MILD',
  },
  Northmarch: {
    weather: [
      { value: 'CLEAR', weight: 22 },
      { value: 'CLOUDY', weight: 30 },
      { value: 'RAIN', weight: 12 },
      { value: 'FOG', weight: 16 },
      { value: 'STORM', weight: 6 },
      { value: 'SNOW', weight: 22 },
    ],
    temperatureBaseline: 'COLD',
  },
};

export const DEFAULT_REGION_ATMOSPHERE_PROFILE: RegionAtmosphereProfile = {
  weather: DEFAULT_WEATHER_WEIGHTS,
  temperatureBaseline: 'MILD',
};

export const WIND_WEIGHTS: WeightedOption<WindLevel>[] = [
  { value: 'STILL', weight: 40 },
  { value: 'BREEZY', weight: 42 },
  { value: 'GUSTY', weight: 18 },
];

export const INTENSITY_WEIGHTS: WeightedOption<IntensityLevel>[] = [
  { value: 'CALM', weight: 45 },
  { value: 'MODERATE', weight: 40 },
  { value: 'STRONG', weight: 15 },
];
