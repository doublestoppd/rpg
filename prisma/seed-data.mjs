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
 * The eight world locations. `slug` is the stable key; regions group
 * locations for later regional commerce.
 */
export const LOCATIONS = [
  {
    slug: 'crownfall-city',
    name: 'Crownfall City',
    region: 'crownfall',
    artworkKey: 'crownfall-city',
    isSafe: true,
    description:
      'The old capital, ringed by pale stone walls and crowned by the Fallen Keep. Travelers rest at the Crownfall Inn, and the museum guards the relics of the region.',
  },
  {
    slug: 'crownfall-market-district',
    name: 'Crownfall Market District',
    region: 'crownfall',
    artworkKey: 'crownfall-market-district',
    isSafe: true,
    description:
      'A maze of awnings, stalls, and clanging workshops. The Crownfall Forge burns day and night beside the general goods counters and the great marketplace boards.',
  },
  {
    slug: 'crownfall-harbor',
    name: 'Crownfall Harbor',
    region: 'crownfall',
    artworkKey: 'crownfall-harbor',
    isSafe: true,
    description:
      'Salt wind, creaking piers, and cargo from distant coasts. Harbor folk trade in specialty imports when the ships come in.',
  },
  {
    slug: 'north-road',
    name: 'North Road',
    region: 'northmarch',
    artworkKey: 'north-road',
    isSafe: false,
    description:
      'The rutted trade road out of Crownfall. Merchants move in convoys here — bandits watch the hedgerows for stragglers.',
  },
  {
    slug: 'greenmeadow-village',
    name: 'Greenmeadow Village',
    region: 'northmarch',
    artworkKey: 'greenmeadow-village',
    isSafe: true,
    description:
      'Thatched roofs, herb gardens, and pastures at the crossroads. Food and herbs are plentiful; forged goods must be carted in at a premium.',
  },
  {
    slug: 'ironroot-mine',
    name: 'Ironroot Mine',
    region: 'deepvale',
    artworkKey: 'ironroot-mine',
    isSafe: false,
    description:
      'Timber-braced shafts sunk beneath the Ironroot hills. Copper seams, iron veins, and stranger pockets — and things that skitter in the dark.',
  },
  {
    slug: 'silvermere-lake',
    name: 'Silvermere Lake',
    region: 'deepvale',
    artworkKey: 'silvermere-lake',
    isSafe: true,
    description:
      'A cold, mirror-still lake famed for its silver-scaled fish. Lakefolk sell the morning catch cheap.',
  },
  {
    slug: 'blackwood-forest',
    name: 'Blackwood Forest',
    region: 'northmarch',
    artworkKey: 'blackwood-forest',
    isSafe: false,
    description:
      'Old-growth dark and dense enough to swallow lantern light. Slimes pool in the hollows and wolves keep the paths.',
  },
];

/** Local features per location. What a place offers comes from these rows. */
export const LOCATION_FEATURES = [
  {
    locationSlug: 'crownfall-city',
    type: 'INN',
    name: 'Crownfall Inn',
    description: 'Warm beds and hot meals. Rest to restore your strength for a level-scaled fee.',
    sortOrder: 1,
  },
  {
    locationSlug: 'crownfall-city',
    type: 'MUSEUM',
    name: 'Museum of Regional Artifacts',
    description: 'Curators accept donations of notable artifacts for the permanent collection.',
    sortOrder: 2,
  },
  {
    locationSlug: 'crownfall-market-district',
    type: 'NPC_SHOP',
    name: 'Crownfall General Goods',
    description: 'Staples, supplies, and sundries — restocked in limited batches.',
    sortOrder: 1,
  },
  {
    locationSlug: 'crownfall-market-district',
    type: 'NPC_SHOP',
    name: 'Crownfall Forge',
    description: 'Smith-made arms and armor in limited supply.',
    sortOrder: 2,
  },
  {
    locationSlug: 'crownfall-market-district',
    type: 'CRAFTING',
    name: 'Crownfall Forge',
    description: 'A working forge: smelt ingots and hammer out blades at the anvils.',
    sortOrder: 3,
  },
  {
    locationSlug: 'crownfall-market-district',
    type: 'MARKETPLACE',
    name: 'Grand Marketplace',
    description: 'The regional trading boards where player shops list their wares.',
    sortOrder: 4,
  },
  {
    locationSlug: 'north-road',
    type: 'COMBAT',
    name: 'Bandit Country',
    description: 'The hedgerows hide roadside bandits preying on lone travelers.',
    sortOrder: 1,
  },
  {
    locationSlug: 'ironroot-mine',
    type: 'GATHERING',
    name: 'Mining Galleries',
    description: 'Work the copper seams, iron veins, and crystal pockets.',
    sortOrder: 1,
  },
  {
    locationSlug: 'ironroot-mine',
    type: 'COMBAT',
    name: 'Deep Shafts',
    description: 'Cave beetles and ember bats nest in the lower galleries.',
    sortOrder: 2,
  },
  {
    locationSlug: 'blackwood-forest',
    type: 'COMBAT',
    name: 'The Dark Paths',
    description: 'Forest slimes, briar wolves — and something larger that shakes the underbrush.',
    sortOrder: 1,
  },
];

/**
 * Directed travel routes; bidirectional roads are two records. Gold costs
 * stay zero until currency charging exists (Phase 8).
 */
const ROUTE_PAIRS = [
  { a: 'crownfall-city', b: 'crownfall-market-district', travelSeconds: 30 },
  { a: 'crownfall-city', b: 'crownfall-harbor', travelSeconds: 60 },
  { a: 'crownfall-city', b: 'north-road', travelSeconds: 90 },
  { a: 'north-road', b: 'greenmeadow-village', travelSeconds: 120 },
  { a: 'north-road', b: 'blackwood-forest', travelSeconds: 150 },
  { a: 'greenmeadow-village', b: 'ironroot-mine', travelSeconds: 150 },
  { a: 'greenmeadow-village', b: 'silvermere-lake', travelSeconds: 120 },
  { a: 'blackwood-forest', b: 'ironroot-mine', travelSeconds: 180 },
];

export const TRAVEL_ROUTES = ROUTE_PAIRS.flatMap(({ a, b, travelSeconds }) => [
  { fromSlug: a, toSlug: b, travelSeconds, goldCost: 0n },
  { fromSlug: b, toSlug: a, travelSeconds, goldCost: 0n },
]);

/** New characters begin here. */
export const STARTING_LOCATION_SLUG = 'crownfall-city';

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
