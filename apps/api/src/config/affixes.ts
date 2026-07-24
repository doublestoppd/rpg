import { type AffixStat, type ItemBonuses, type ItemRarity, type RolledAffix } from '@rpg/shared';
import { z } from 'zod';

/**
 * Equipment rarity and rolled affixes (Improvement Phase 2). Every roll is
 * server-authoritative and driven by an injected integer source, so combat
 * drops replay identically from a persisted (seed, counter) pair and unit
 * tests drive the outcomes deterministically. All magnitudes are integers.
 *
 * COMMON items (plain/crafted/shop/legacy) carry no affixes; combat drops roll
 * a rarity and that rarity's number of distinct-stat affixes.
 */

/** Minimal integer source both the combat PRNG and a secure adapter satisfy. */
export interface RollRng {
  /** Uniform integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number;
}

const zeroBonuses: ItemBonuses = {
  strength: 0,
  agility: 0,
  magic: 0,
  defense: 0,
  magicDefense: 0,
  luck: 0,
  maxHp: 0,
  maxMp: 0,
};

interface AffixStatSpec {
  /** Flavor name stored on the roll and shown beside the numeric bonus. */
  label: string;
  /** Base magnitude range at level 1, before level scaling. */
  min: number;
  max: number;
  /** +1 magnitude per this many levels of the item's level requirement. */
  levelDivisor: number;
}

/**
 * The affix pool: one entry per bonus stat. Core combat stats roll small; the
 * larger HP/MP pools roll bigger numbers so a vitality affix feels comparable.
 */
export const AFFIX_STATS: Record<AffixStat, AffixStatSpec> = {
  strength: { label: 'of Might', min: 1, max: 3, levelDivisor: 6 },
  agility: { label: 'of Swiftness', min: 1, max: 3, levelDivisor: 6 },
  magic: { label: 'of Sorcery', min: 1, max: 3, levelDivisor: 6 },
  defense: { label: 'of Warding', min: 1, max: 3, levelDivisor: 6 },
  magicDefense: { label: 'of Aegis', min: 1, max: 3, levelDivisor: 6 },
  luck: { label: 'of Fortune', min: 1, max: 3, levelDivisor: 6 },
  maxHp: { label: 'of Vitality', min: 6, max: 14, levelDivisor: 2 },
  maxMp: { label: 'of Insight', min: 3, max: 7, levelDivisor: 3 },
};

const ALL_STATS = Object.keys(AFFIX_STATS) as AffixStat[];

interface RaritySpec {
  /** Number of distinct-stat affixes rolled at this rarity. */
  affixCount: number;
  /** Relative weight in the combat-drop rarity roll. */
  dropWeight: number;
}

export const RARITY_SPECS: Record<ItemRarity, RaritySpec> = {
  COMMON: { affixCount: 0, dropWeight: 60 },
  UNCOMMON: { affixCount: 1, dropWeight: 25 },
  RARE: { affixCount: 2, dropWeight: 10 },
  EPIC: { affixCount: 3, dropWeight: 4 },
  LEGENDARY: { affixCount: 4, dropWeight: 1 },
};

const RARITY_ORDER = Object.keys(RARITY_SPECS) as ItemRarity[];

export function affixCountForRarity(rarity: ItemRarity): number {
  return RARITY_SPECS[rarity].affixCount;
}

/** Weighted rarity draw for a combat equipment drop. */
export function rollRarity(rng: RollRng): ItemRarity {
  const total = RARITY_ORDER.reduce((sum, r) => sum + RARITY_SPECS[r].dropWeight, 0);
  let roll = rng.nextInt(1, total);
  for (const rarity of RARITY_ORDER) {
    roll -= RARITY_SPECS[rarity].dropWeight;
    if (roll <= 0) return rarity;
  }
  return 'COMMON';
}

/** One affix's magnitude: base range plus integer level scaling, floor ≥ 1. */
function rollMagnitude(rng: RollRng, spec: AffixStatSpec, levelRequirement: number): number {
  const base = rng.nextInt(spec.min, spec.max);
  const scaled = base + Math.floor(Math.max(1, levelRequirement) / spec.levelDivisor);
  return Math.max(1, scaled);
}

/**
 * Rolls this rarity's affixes on distinct stats. Distinctness comes from a
 * deterministic partial Fisher–Yates over the stat pool, so no stat is rolled
 * twice and the selection is reproducible from the same integer source.
 */
export function rollAffixes(
  rng: RollRng,
  rarity: ItemRarity,
  levelRequirement: number,
): RolledAffix[] {
  const count = Math.min(affixCountForRarity(rarity), ALL_STATS.length);
  const pool = [...ALL_STATS];
  const chosen: AffixStat[] = [];
  for (let i = 0; i < count; i++) {
    const j = rng.nextInt(i, pool.length - 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    chosen.push(pool[i]!);
  }
  return chosen.map((stat) => {
    const spec = AFFIX_STATS[stat];
    return { stat, magnitude: rollMagnitude(rng, spec, levelRequirement), label: spec.label };
  });
}

/**
 * Rolls a dropped instance's quality. Only equipment (an item with a slot)
 * rolls; everything else stays COMMON with no affixes.
 */
export function rollEquipmentDrop(
  rng: RollRng,
  def: { equipmentSlot: string | null; levelRequirement: number },
): { rarity: ItemRarity; affixes: RolledAffix[] } {
  if (def.equipmentSlot === null) return { rarity: 'COMMON', affixes: [] };
  const rarity = rollRarity(rng);
  return { rarity, affixes: rollAffixes(rng, rarity, def.levelRequirement) };
}

/** Validates a persisted affix JSON blob into typed affixes (unknown → []). */
const persistedAffixesSchema = z.array(
  z.object({
    stat: z.enum([
      'strength',
      'agility',
      'magic',
      'defense',
      'magicDefense',
      'luck',
      'maxHp',
      'maxMp',
    ]),
    magnitude: z.number().int().min(1),
    label: z.string().min(1),
  }),
);

export function parseAffixes(raw: unknown): RolledAffix[] {
  const result = persistedAffixesSchema.safeParse(raw);
  return result.success ? result.data : [];
}

/** Sum of the affixes' contributions, keyed like ItemBonuses. */
export function affixBonuses(affixes: RolledAffix[]): ItemBonuses {
  const bonuses: ItemBonuses = { ...zeroBonuses };
  for (const affix of affixes) bonuses[affix.stat] += affix.magnitude;
  return bonuses;
}

interface DefinitionBonuses {
  bonusStrength: number;
  bonusAgility: number;
  bonusMagic: number;
  bonusDefense: number;
  bonusMagicDefense: number;
  bonusLuck: number;
  bonusMaxHp: number;
  bonusMaxMp: number;
}

/** Definition base bonuses plus affixes, in ItemBonuses shape (for views). */
export function effectiveItemBonuses(def: DefinitionBonuses, affixes: RolledAffix[]): ItemBonuses {
  const affix = affixBonuses(affixes);
  return {
    strength: def.bonusStrength + affix.strength,
    agility: def.bonusAgility + affix.agility,
    magic: def.bonusMagic + affix.magic,
    defense: def.bonusDefense + affix.defense,
    magicDefense: def.bonusMagicDefense + affix.magicDefense,
    luck: def.bonusLuck + affix.luck,
    maxHp: def.bonusMaxHp + affix.maxHp,
    maxMp: def.bonusMaxMp + affix.maxMp,
  };
}

/** Definition base bonuses plus affixes, in the EquipmentBonusSource shape. */
export function equipmentBonusSource(
  def: DefinitionBonuses,
  affixes: RolledAffix[],
): DefinitionBonuses {
  const affix = affixBonuses(affixes);
  return {
    bonusStrength: def.bonusStrength + affix.strength,
    bonusAgility: def.bonusAgility + affix.agility,
    bonusMagic: def.bonusMagic + affix.magic,
    bonusDefense: def.bonusDefense + affix.defense,
    bonusMagicDefense: def.bonusMagicDefense + affix.magicDefense,
    bonusLuck: def.bonusLuck + affix.luck,
    bonusMaxHp: def.bonusMaxHp + affix.maxHp,
    bonusMaxMp: def.bonusMaxMp + affix.maxMp,
  };
}
