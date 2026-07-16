/**
 * Canonical seed data. Single source of truth for data-driven configuration;
 * seeded idempotently by prisma/seed.mjs and asserted by tests.
 */

export const CHARACTER_CLASSES = [
  {
    slug: 'vanguard',
    name: 'Vanguard',
    description:
      'A shield-bearing frontline fighter. Vanguards trade speed for raw endurance, heavy strikes, and the stubborn refusal to fall.',
    baseHp: 120,
    baseMp: 20,
    baseStamina: 100,
    baseStrength: 14,
    baseAgility: 8,
    baseMagic: 4,
    baseDefense: 12,
    baseMagicDefense: 8,
    baseLuck: 6,
    growthHp: 12,
    growthMp: 2,
    growthStrength: 3,
    growthAgility: 1,
    growthMagic: 1,
    growthDefense: 3,
    growthMagicDefense: 1,
    growthLuck: 1,
  },
  {
    slug: 'wayfarer',
    name: 'Wayfarer',
    description:
      'A swift scout at home on every road. Wayfarers strike first, slip away unharmed, and always seem to find a little extra luck.',
    baseHp: 95,
    baseMp: 30,
    baseStamina: 100,
    baseStrength: 10,
    baseAgility: 14,
    baseMagic: 6,
    baseDefense: 8,
    baseMagicDefense: 8,
    baseLuck: 10,
    growthHp: 9,
    growthMp: 3,
    growthStrength: 2,
    growthAgility: 3,
    growthMagic: 1,
    growthDefense: 2,
    growthMagicDefense: 2,
    growthLuck: 2,
  },
  {
    slug: 'arcanist',
    name: 'Arcanist',
    description:
      'A scholar of the four elements. Arcanists are fragile up close but command flame, frost, and storm with devastating precision.',
    baseHp: 80,
    baseMp: 60,
    baseStamina: 100,
    baseStrength: 5,
    baseAgility: 9,
    baseMagic: 15,
    baseDefense: 6,
    baseMagicDefense: 12,
    baseLuck: 7,
    growthHp: 7,
    growthMp: 6,
    growthStrength: 1,
    growthAgility: 2,
    growthMagic: 3,
    growthDefense: 1,
    growthMagicDefense: 3,
    growthLuck: 1,
  },
];

/**
 * Cumulative XP required to hold each level (level cap = 20).
 * Strictly monotonic; validated at seed time.
 */
export const LEVEL_PROGRESSION = [
  { level: 1, cumulativeXp: 0 },
  { level: 2, cumulativeXp: 100 },
  { level: 3, cumulativeXp: 300 },
  { level: 4, cumulativeXp: 600 },
  { level: 5, cumulativeXp: 1000 },
  { level: 6, cumulativeXp: 1500 },
  { level: 7, cumulativeXp: 2200 },
  { level: 8, cumulativeXp: 3100 },
  { level: 9, cumulativeXp: 4200 },
  { level: 10, cumulativeXp: 5500 },
  { level: 11, cumulativeXp: 7100 },
  { level: 12, cumulativeXp: 9000 },
  { level: 13, cumulativeXp: 11200 },
  { level: 14, cumulativeXp: 13700 },
  { level: 15, cumulativeXp: 16600 },
  { level: 16, cumulativeXp: 19900 },
  { level: 17, cumulativeXp: 23600 },
  { level: 18, cumulativeXp: 27800 },
  { level: 19, cumulativeXp: 32500 },
  { level: 20, cumulativeXp: 37800 },
];
