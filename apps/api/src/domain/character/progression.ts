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

/** Equipment stat contributions summed over equipped item definitions. */
export interface EquipmentBonusSource {
  bonusStrength: number;
  bonusAgility: number;
  bonusMagic: number;
  bonusDefense: number;
  bonusMagicDefense: number;
  bonusLuck: number;
  bonusMaxHp: number;
  bonusMaxMp: number;
}

/**
 * Derived stats from class + level (+ equipment): base + growth * (level - 1)
 * plus the sum of equipped item bonuses. Never duplicated in tables.
 */
export function computeDerivedStats(
  classDef: CharacterClassDefinition,
  level: number,
  equipment: EquipmentBonusSource[] = [],
): DerivedStats {
  const steps = level - 1;
  const bonus = equipment.reduce(
    (acc, item) => ({
      strength: acc.strength + item.bonusStrength,
      agility: acc.agility + item.bonusAgility,
      magic: acc.magic + item.bonusMagic,
      defense: acc.defense + item.bonusDefense,
      magicDefense: acc.magicDefense + item.bonusMagicDefense,
      luck: acc.luck + item.bonusLuck,
      maxHp: acc.maxHp + item.bonusMaxHp,
      maxMp: acc.maxMp + item.bonusMaxMp,
    }),
    { strength: 0, agility: 0, magic: 0, defense: 0, magicDefense: 0, luck: 0, maxHp: 0, maxMp: 0 },
  );
  return {
    maxHp: classDef.baseHp + classDef.growthHp * steps + bonus.maxHp,
    maxMp: classDef.baseMp + classDef.growthMp * steps + bonus.maxMp,
    maxStamina: classDef.baseStamina,
    strength: classDef.baseStrength + classDef.growthStrength * steps + bonus.strength,
    agility: classDef.baseAgility + classDef.growthAgility * steps + bonus.agility,
    magic: classDef.baseMagic + classDef.growthMagic * steps + bonus.magic,
    defense: classDef.baseDefense + classDef.growthDefense * steps + bonus.defense,
    magicDefense:
      classDef.baseMagicDefense + classDef.growthMagicDefense * steps + bonus.magicDefense,
    luck: classDef.baseLuck + classDef.growthLuck * steps + bonus.luck,
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
