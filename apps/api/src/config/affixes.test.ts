import { describe, expect, it } from 'vitest';

import {
  AFFIX_STATS,
  affixBonuses,
  affixCountForRarity,
  effectiveItemBonuses,
  equipmentBonusSource,
  parseAffixes,
  RARITY_SPECS,
  rollAffixes,
  rollEquipmentDrop,
  rollRarity,
  type RollRng,
} from './affixes.js';

/** Scriptable integer source; falls back to `min` when the script is spent. */
function rig(ints: number[] = []): RollRng {
  const queue = [...ints];
  return { nextInt: (min: number) => (queue.length > 0 ? queue.shift()! : min) };
}

const zeroDef = {
  bonusStrength: 0,
  bonusAgility: 0,
  bonusMagic: 0,
  bonusDefense: 0,
  bonusMagicDefense: 0,
  bonusLuck: 0,
  bonusMaxHp: 0,
  bonusMaxMp: 0,
};

describe('rarity roll', () => {
  const total = Object.values(RARITY_SPECS).reduce((sum, s) => sum + s.dropWeight, 0);

  it('maps the weighted roll to the right tier at the boundaries', () => {
    expect(rollRarity(rig([1]))).toBe('COMMON');
    expect(rollRarity(rig([RARITY_SPECS.COMMON.dropWeight]))).toBe('COMMON');
    expect(rollRarity(rig([RARITY_SPECS.COMMON.dropWeight + 1]))).toBe('UNCOMMON');
    expect(rollRarity(rig([total]))).toBe('LEGENDARY');
  });

  it('affix count rises with rarity', () => {
    expect(affixCountForRarity('COMMON')).toBe(0);
    expect(affixCountForRarity('UNCOMMON')).toBe(1);
    expect(affixCountForRarity('RARE')).toBe(2);
    expect(affixCountForRarity('EPIC')).toBe(3);
    expect(affixCountForRarity('LEGENDARY')).toBe(4);
  });
});

describe('affix roll', () => {
  it('rolls exactly the rarity count of distinct-stat affixes', () => {
    const affixes = rollAffixes(rig([0, 1, 2, 3]), 'LEGENDARY', 1);
    expect(affixes).toHaveLength(4);
    const stats = affixes.map((a) => a.stat);
    expect(new Set(stats).size).toBe(4); // no stat rolled twice
    for (const affix of affixes) {
      expect(affix.magnitude).toBeGreaterThanOrEqual(1);
      expect(affix.label).toBe(AFFIX_STATS[affix.stat].label);
    }
  });

  it('COMMON rolls nothing', () => {
    expect(rollAffixes(rig(), 'COMMON', 50)).toEqual([]);
  });

  it('magnitude includes integer level scaling within the stat bounds', () => {
    // Force the first stat to be `luck` (swap index 0 with itself), then let the
    // magnitude draw fall through to the spec minimum.
    const luckIndex = (Object.keys(AFFIX_STATS) as (keyof typeof AFFIX_STATS)[]).indexOf('luck');
    const level = 30;
    const spec = AFFIX_STATS.luck;
    const [affix] = rollAffixes(rig([luckIndex, spec.min]), 'UNCOMMON', level);
    expect(affix!.stat).toBe('luck');
    const scale = Math.floor(level / spec.levelDivisor);
    expect(affix!.magnitude).toBe(spec.min + scale);
  });

  it('is deterministic for the same integer script', () => {
    const script = [3, 5, 1, 2, 7, 4];
    expect(rollAffixes(rig(script), 'RARE', 12)).toEqual(rollAffixes(rig(script), 'RARE', 12));
  });
});

describe('equipment drop roll', () => {
  it('never rolls quality on non-equipment', () => {
    const result = rollEquipmentDrop(rig([999]), { equipmentSlot: null, levelRequirement: 5 });
    expect(result.rarity).toBe('COMMON');
    expect(result.affixes).toEqual([]);
  });

  it('rolls rarity and its affixes on equipment', () => {
    // roll 1 → COMMON (no affixes); the max weighted roll → LEGENDARY (four).
    expect(
      rollEquipmentDrop(rig([1]), { equipmentSlot: 'MAIN_HAND', levelRequirement: 1 }).affixes,
    ).toHaveLength(0);
    const total = Object.values(RARITY_SPECS).reduce((sum, s) => sum + s.dropWeight, 0);
    const legendary = rollEquipmentDrop(rig([total, 0, 1, 2, 3]), {
      equipmentSlot: 'MAIN_HAND',
      levelRequirement: 1,
    });
    expect(legendary.rarity).toBe('LEGENDARY');
    expect(legendary.affixes).toHaveLength(4);
  });
});

describe('bonus aggregation', () => {
  it('sums affixes per stat', () => {
    const bonuses = affixBonuses([
      { stat: 'luck', magnitude: 2, label: 'of Fortune' },
      { stat: 'luck', magnitude: 3, label: 'of Fortune' },
      { stat: 'maxHp', magnitude: 10, label: 'of Vitality' },
    ]);
    expect(bonuses.luck).toBe(5);
    expect(bonuses.maxHp).toBe(10);
    expect(bonuses.strength).toBe(0);
  });

  it('combines definition bonuses with affixes both ways', () => {
    const def = { ...zeroDef, bonusStrength: 4, bonusLuck: 1 };
    const affixes = [{ stat: 'luck' as const, magnitude: 2, label: 'of Fortune' }];
    expect(effectiveItemBonuses(def, affixes)).toMatchObject({ strength: 4, luck: 3 });
    expect(equipmentBonusSource(def, affixes)).toMatchObject({ bonusStrength: 4, bonusLuck: 3 });
  });
});

describe('persisted affix parsing', () => {
  it('accepts a valid blob and rejects malformed data', () => {
    const valid = [{ stat: 'agility', magnitude: 2, label: 'of Swiftness' }];
    expect(parseAffixes(valid)).toEqual(valid);
    expect(parseAffixes('not-an-array')).toEqual([]);
    expect(parseAffixes([{ stat: 'bogus', magnitude: 1, label: 'x' }])).toEqual([]);
    expect(parseAffixes([{ stat: 'luck', magnitude: 0, label: 'x' }])).toEqual([]);
  });
});
