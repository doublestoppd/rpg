import { describe, expect, it } from 'vitest';

import { isReforgeable, reforgeCost } from './reforge.js';

describe('reforge pricing', () => {
  it('only non-common rarities are reforgeable', () => {
    expect(isReforgeable('COMMON')).toBe(false);
    expect(isReforgeable('UNCOMMON')).toBe(true);
    expect(isReforgeable('LEGENDARY')).toBe(true);
  });

  it('cost is a rarity base plus a per-level surcharge', () => {
    expect(reforgeCost('COMMON', 10)).toBe(0n);
    expect(reforgeCost('RARE', 3)).toBe(240n + 24n * 3n);
    expect(reforgeCost('LEGENDARY', 30)).toBe(3200n + 200n * 30n);
  });

  it('rises with both rarity and level', () => {
    expect(reforgeCost('EPIC', 20)).toBeGreaterThan(reforgeCost('RARE', 20));
    expect(reforgeCost('RARE', 30)).toBeGreaterThan(reforgeCost('RARE', 1));
  });
});
