import type { CharacterClassDefinition, LevelProgression } from '@prisma/client';
import type { CharacterAttributes } from '@rpg/shared';

/**
 * Pure progression math. All inputs come from seeded data-driven
 * configuration; nothing here hard-codes class stats or XP thresholds.
 */

export interface DerivedStats extends CharacterAttributes {
  maxHp: number;
  maxMp: number;
  maxStamina: number;
}

/** Derived stats from class + level: base + growth * (level - 1). */
export function computeDerivedStats(
  classDef: CharacterClassDefinition,
  level: number,
): DerivedStats {
  const steps = level - 1;
  return {
    maxHp: classDef.baseHp + classDef.growthHp * steps,
    maxMp: classDef.baseMp + classDef.growthMp * steps,
    maxStamina: classDef.baseStamina,
    strength: classDef.baseStrength + classDef.growthStrength * steps,
    agility: classDef.baseAgility + classDef.growthAgility * steps,
    magic: classDef.baseMagic + classDef.growthMagic * steps,
    defense: classDef.baseDefense + classDef.growthDefense * steps,
    magicDefense: classDef.baseMagicDefense + classDef.growthMagicDefense * steps,
    luck: classDef.baseLuck + classDef.growthLuck * steps,
  };
}

/** Highest seeded level whose cumulative XP requirement is met. */
export function levelForXp(progression: LevelProgression[], xp: number): number {
  let level = 1;
  for (const row of progression) {
    if (xp >= row.cumulativeXp) level = Math.max(level, row.level);
  }
  return level;
}

/** Cumulative XP needed for the next level, or null at the cap. */
export function xpForNextLevel(progression: LevelProgression[], level: number): number | null {
  const next = progression.find((row) => row.level === level + 1);
  return next ? next.cumulativeXp : null;
}

/** The level cap is the highest seeded level. */
export function levelCap(progression: LevelProgression[]): number {
  return progression.reduce((max, row) => Math.max(max, row.level), 1);
}

/**
 * Lazily regenerated stamina: stored value plus whole units for elapsed time,
 * clamped to the maximum. Pure — persisting is the caller's concern and only
 * required when stamina is spent.
 */
export function effectiveStamina(input: {
  stored: number;
  storedAt: Date;
  now: Date;
  maxStamina: number;
  regenPerInterval: number;
  intervalMs: number;
}): number {
  const elapsed = Math.max(0, input.now.getTime() - input.storedAt.getTime());
  const regenerated = Math.floor(elapsed / input.intervalMs) * input.regenPerInterval;
  return Math.min(input.maxStamina, input.stored + regenerated);
}
