import { createHmac, randomBytes } from 'node:crypto';

import type { PrismaClient, RegionAtmosphereState } from '@prisma/client';
import type { AtmosphereResponse } from '@rpg/shared';

import {
  CROWD_LEVELS,
  type CrowdLevel,
  DEFAULT_REGION_ATMOSPHERE_PROFILE,
  INTENSITY_WEIGHTS,
  type IntensityLevel,
  REGION_ATMOSPHERE_PROFILES,
  TEMPERATURE_LEVELS,
  type TemperatureLevel,
  type VisibilityLevel,
  type WeatherType,
  type WeightedOption,
  WIND_WEIGHTS,
  type WindLevel,
  type WorldTimeSegment,
} from '../../config/world.js';
import { metrics } from '../../lib/metrics.js';
import { computeWorldTime, type WorldClockService } from './world-clock.js';

const ATMOSPHERE_SECRET_ID = 'atmosphere';

/** True when a Prisma error is a unique-constraint violation (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

/**
 * Deterministic weighted pick. The draw is HMAC-SHA256(secret, label) reduced
 * to a uniform integer in [0, totalWeight), so the same (secret, region,
 * cycleId, field) always resolves to the same option — the atmosphere for a
 * cycle is fixed, unpredictable without the secret, and identical whether the
 * worker or a lazy request finalizes it first.
 */
function deterministicPick<T extends string>(
  secretHex: string,
  label: string,
  options: WeightedOption<T>[],
): T {
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  const digest = createHmac('sha256', secretHex).update(label).digest();
  let roll = digest.readUInt32BE(0) % total;
  for (const option of options) {
    if (roll < option.weight) return option.value;
    roll -= option.weight;
  }
  return options[options.length - 1]!.value;
}

function visibilityFor(weather: WeatherType): VisibilityLevel {
  if (weather === 'FOG' || weather === 'STORM') return 'POOR';
  if (weather === 'RAIN' || weather === 'SNOW') return 'REDUCED';
  return 'CLEAR';
}

function shiftLevel<T extends string>(levels: readonly T[], value: T, by: number): T {
  const index = levels.indexOf(value);
  const next = Math.min(levels.length - 1, Math.max(0, index + by));
  return levels[next]!;
}

function temperatureFor(
  baseline: TemperatureLevel,
  segment: WorldTimeSegment,
  weather: WeatherType,
): TemperatureLevel {
  let value = baseline;
  if (segment === 'NIGHT' || segment === 'DAWN') value = shiftLevel(TEMPERATURE_LEVELS, value, -1);
  if (segment === 'DAY') value = shiftLevel(TEMPERATURE_LEVELS, value, 1);
  if (weather === 'SNOW') value = 'COLD';
  return value;
}

function crowdFor(segment: WorldTimeSegment, weather: WeatherType): CrowdLevel {
  const base: CrowdLevel = segment === 'DAY' ? 'BUSY' : segment === 'NIGHT' ? 'QUIET' : 'MODERATE';
  const stormy = weather === 'STORM';
  return stormy ? shiftLevel(CROWD_LEVELS, base, -1) : base;
}

function intensityFor(secretHex: string, label: string, weather: WeatherType): IntensityLevel {
  const drawn = deterministicPick<IntensityLevel>(secretHex, label, INTENSITY_WEIGHTS);
  if (weather === 'STORM') return 'STRONG';
  if (weather === 'CLEAR' && drawn === 'STRONG') return 'MODERATE';
  return drawn;
}

export interface AtmosphereFields {
  weather: WeatherType;
  intensity: IntensityLevel;
  visibility: VisibilityLevel;
  temperature: TemperatureLevel;
  wind: WindLevel;
  crowdLevel: CrowdLevel;
  descriptionKey: string;
}

/** Pure deterministic derivation for a region + cycle + segment. */
export function deriveAtmosphere(
  secretHex: string,
  region: string,
  cycleId: string,
  segment: WorldTimeSegment,
): AtmosphereFields {
  const profile = REGION_ATMOSPHERE_PROFILES[region] ?? DEFAULT_REGION_ATMOSPHERE_PROFILE;
  const prefix = `${region}:${cycleId}`;
  const weather = deterministicPick<WeatherType>(secretHex, `${prefix}:weather`, profile.weather);
  const wind = deterministicPick<WindLevel>(secretHex, `${prefix}:wind`, WIND_WEIGHTS);
  return {
    weather,
    wind,
    intensity: intensityFor(secretHex, `${prefix}:intensity`, weather),
    visibility: visibilityFor(weather),
    temperature: temperatureFor(profile.temperatureBaseline, segment, weather),
    crowdLevel: crowdFor(segment, weather),
    descriptionKey: `atmosphere.${weather.toLowerCase()}`,
  };
}

function toResponse(row: RegionAtmosphereState): AtmosphereResponse {
  return {
    region: row.region,
    cycleId: row.cycleId,
    weather: row.weather as WeatherType,
    intensity: row.intensity as IntensityLevel,
    visibility: row.visibility as VisibilityLevel,
    temperature: row.temperature as TemperatureLevel,
    wind: row.wind as WindLevel,
    crowdLevel: row.crowdLevel as CrowdLevel,
    descriptionKey: row.descriptionKey,
    startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    configRevision: row.configRevision,
  };
}

export interface AtmosphereService {
  /** Idempotently finalizes and returns the current atmosphere for a region. */
  finalizeCurrent(region: string, now?: Date): Promise<AtmosphereResponse>;
}

export function createAtmosphereService(
  prisma: PrismaClient,
  worldClock: WorldClockService,
): AtmosphereService {
  /** The persisted server secret, created lazily with secure random bytes. */
  async function ensureSecret(): Promise<string> {
    const existing = await prisma.worldSecret.findUnique({ where: { id: ATMOSPHERE_SECRET_ID } });
    if (existing) return existing.seedHex;
    const seedHex = randomBytes(32).toString('hex');
    try {
      await prisma.worldSecret.create({ data: { id: ATMOSPHERE_SECRET_ID, seedHex } });
      return seedHex;
    } catch (error) {
      if (isUniqueViolation(error)) {
        const row = await prisma.worldSecret.findUniqueOrThrow({
          where: { id: ATMOSPHERE_SECRET_ID },
        });
        return row.seedHex;
      }
      throw error;
    }
  }

  return {
    async finalizeCurrent(region, now = new Date()) {
      const config = await worldClock.activeConfig();
      const time = computeWorldTime(config, now);
      const cycleId = time.cycleId;

      const existing = await prisma.regionAtmosphereState.findUnique({
        where: { region_cycleId: { region, cycleId } },
      });
      if (existing) return toResponse(existing);

      const secretHex = await ensureSecret();
      const fields = deriveAtmosphere(secretHex, region, cycleId, time.segment);
      try {
        const created = await prisma.regionAtmosphereState.create({
          data: {
            region,
            cycleId,
            ...fields,
            startsAt: new Date(time.cycleStartsAt),
            expiresAt: new Date(time.cycleEndsAt),
            configRevision: config.revision,
          },
        });
        metrics.increment('atmosphere_lazy_finalization');
        return toResponse(created);
      } catch (error) {
        if (isUniqueViolation(error)) {
          // A concurrent request finalized the same (region, cycle) first;
          // deterministic derivation guarantees the stored row matches ours.
          metrics.increment('atmosphere_finalization_conflict');
          const row = await prisma.regionAtmosphereState.findUniqueOrThrow({
            where: { region_cycleId: { region, cycleId } },
          });
          return toResponse(row);
        }
        throw error;
      }
    },
  };
}
