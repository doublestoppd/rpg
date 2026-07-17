import { createHmac, randomBytes } from 'node:crypto';

/**
 * Deterministic combat PRNG (ADR 0005 applies: the seed itself comes from
 * secure server randomness). Every draw is HMAC-SHA256(seed, counter), so a
 * persisted (seed, counter) pair replays identically after a refresh or
 * crash. The seed is server-secret until the combat completes.
 */

/** Fresh server-secret seed for a new combat. */
export function newCombatSeed(): string {
  return randomBytes(32).toString('hex');
}

export interface CombatRng {
  /** Uniform integer in [min, max] inclusive; advances the counter. */
  nextInt(min: number, max: number): number;
  /** Draws once against a basis-point chance; advances the counter. */
  chance(bps: number): boolean;
  /** The counter to persist after resolution. */
  readonly counter: number;
}

export function createCombatRng(seed: string, startCounter: number): CombatRng {
  let counter = startCounter;

  function draw(): number {
    const digest = createHmac('sha256', seed).update(String(counter)).digest();
    counter += 1;
    return digest.readUInt32BE(0);
  }

  return {
    nextInt(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new Error(`combat rng: invalid range ${min}..${max}`);
      }
      if (min === max) return min;
      const span = max - min + 1;
      return min + (draw() % span);
    },
    chance(bps) {
      if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
        throw new Error(`combat rng: invalid chance ${bps}`);
      }
      if (bps === 0) return false;
      if (bps === 10_000) return true;
      return this.nextInt(1, 10_000) <= bps;
    },
    get counter() {
      return counter;
    },
  };
}
