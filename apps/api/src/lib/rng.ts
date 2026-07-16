import { randomInt } from 'node:crypto';

/**
 * Server-authoritative randomness (ADR 0005). Node crypto for one-shot draws;
 * never Math.random() on authoritative paths.
 */

/** Uniform integer in [min, max] inclusive. */
export function secureInt(min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new Error(`secureInt: invalid range ${min}..${max}`);
  }
  if (min === max) return min;
  return randomInt(min, max + 1);
}

export interface Weighted {
  weight: number;
}

/**
 * Weighted sampling without replacement: picks up to `count` distinct entries,
 * each draw proportional to remaining weights.
 */
export function weightedSample<T extends Weighted>(pool: T[], count: number): T[] {
  const remaining = [...pool];
  const picked: T[] = [];
  while (picked.length < count && remaining.length > 0) {
    const total = remaining.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = secureInt(1, total);
    let index = 0;
    for (; index < remaining.length; index++) {
      roll -= remaining[index]!.weight;
      if (roll <= 0) break;
    }
    picked.push(remaining.splice(Math.min(index, remaining.length - 1), 1)[0]!);
  }
  return picked;
}
