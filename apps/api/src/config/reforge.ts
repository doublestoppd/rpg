import type { ItemRarity } from '@rpg/shared';

/**
 * Reforge pricing (Improvement Phase 4). Cost rises steeply with rarity and
 * with the item's level requirement, so rerolling top-tier gear is a serious
 * Gold sink. All Gold is BIGINT. COMMON items have no affixes and cannot be
 * reforged.
 */

interface RarityCost {
  /** Flat base cost in Gold. */
  base: bigint;
  /** Additional Gold per level of the item's level requirement. */
  perLevel: bigint;
}

const REFORGE_COST: Record<ItemRarity, RarityCost | null> = {
  COMMON: null,
  UNCOMMON: { base: 60n, perLevel: 8n },
  RARE: { base: 240n, perLevel: 24n },
  EPIC: { base: 900n, perLevel: 70n },
  LEGENDARY: { base: 3200n, perLevel: 200n },
};

export function isReforgeable(rarity: ItemRarity): boolean {
  return REFORGE_COST[rarity] !== null;
}

/** Gold cost to reforge an item of this rarity and level requirement. */
export function reforgeCost(rarity: ItemRarity, levelRequirement: number): bigint {
  const spec = REFORGE_COST[rarity];
  if (!spec) return 0n;
  const level = BigInt(Math.max(1, levelRequirement));
  return spec.base + spec.perLevel * level;
}
