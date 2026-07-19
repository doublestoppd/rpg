import { describe, expect, it } from 'vitest';

import {
  CROWD_LEVELS,
  INTENSITY_LEVELS,
  TEMPERATURE_LEVELS,
  VISIBILITY_LEVELS,
  WEATHER_TYPES,
  WIND_LEVELS,
} from '../../config/world.js';
import { deriveAtmosphere } from './atmosphere-service.js';

/**
 * Atmosphere derivation is a pure function of (secret, region, cycleId,
 * segment). These tests pin the determinism and invariants the stored-once
 * finalization relies on.
 */

const SECRET = 'a'.repeat(64);

describe('deterministic atmosphere derivation', () => {
  it('yields the identical result for the same region and cycle', () => {
    const a = deriveAtmosphere(SECRET, 'crownfall', 'C100', 'DAY');
    const b = deriveAtmosphere(SECRET, 'crownfall', 'C100', 'DAY');
    expect(a).toEqual(b);
  });

  it('produces only valid enum members across many cycles and regions', () => {
    for (const region of ['crownfall', 'northmarch', 'Unlisted']) {
      for (let cycle = 0; cycle < 40; cycle++) {
        const fields = deriveAtmosphere(SECRET, region, `C${cycle}`, 'DUSK');
        expect(WEATHER_TYPES).toContain(fields.weather);
        expect(INTENSITY_LEVELS).toContain(fields.intensity);
        expect(VISIBILITY_LEVELS).toContain(fields.visibility);
        expect(TEMPERATURE_LEVELS).toContain(fields.temperature);
        expect(WIND_LEVELS).toContain(fields.wind);
        expect(CROWD_LEVELS).toContain(fields.crowdLevel);
        expect(fields.descriptionKey).toBe(`atmosphere.${fields.weather.toLowerCase()}`);
        // Derived invariants.
        if (fields.weather === 'SNOW') expect(fields.temperature).toBe('COLD');
        if (fields.weather === 'STORM') {
          expect(fields.visibility).toBe('POOR');
          expect(fields.intensity).toBe('STRONG');
        }
      }
    }
  });

  it('varies with the secret, so atmosphere is unpredictable without it', () => {
    const withA = Array.from(
      { length: 20 },
      (_, i) => deriveAtmosphere('a'.repeat(64), 'crownfall', `C${i}`, 'DAY').weather,
    );
    const withB = Array.from(
      { length: 20 },
      (_, i) => deriveAtmosphere('b'.repeat(64), 'crownfall', `C${i}`, 'DAY').weather,
    );
    expect(withA).not.toEqual(withB);
  });
});
