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
 * The 25-item coherent seed: 5 resources, 4 consumables, 6 equipment,
 * 3 crafting components, 3 collectibles, 2 quest items, 2 specialty goods.
 * Stackable commodities set maxStackQuantity; equipment is instance-tracked.
 */
export const ITEM_DEFINITIONS = [
  // --- Resources (5) ---
  {
    slug: 'copper-ore',
    name: 'Copper Ore',
    category: 'RESOURCE',
    stackable: true,
    maxStackQuantity: 99,
    baseValue: 4n,
    description: 'Rough chunks of green-veined rock from the Ironroot copper seams.',
  },
  {
    slug: 'iron-ore',
    name: 'Iron Ore',
    category: 'RESOURCE',
    stackable: true,
    maxStackQuantity: 99,
    baseValue: 7n,
    description: 'Heavy gray ore that rings like a bell when struck.',
  },
  {
    slug: 'glimmer-crystal',
    name: 'Glimmer Crystal',
    category: 'RESOURCE',
    stackable: true,
    maxStackQuantity: 50,
    baseValue: 25n,
    description: 'A faintly glowing crystal found in rare pockets deep in the mine.',
  },
  {
    slug: 'silvermere-perch',
    name: 'Silvermere Perch',
    category: 'RESOURCE',
    stackable: true,
    maxStackQuantity: 99,
    baseValue: 5n,
    description: 'A silver-scaled lake fish, best eaten fresh.',
  },
  {
    slug: 'meadow-herb',
    name: 'Meadow Herb',
    category: 'RESOURCE',
    stackable: true,
    maxStackQuantity: 99,
    baseValue: 3n,
    description: 'A fragrant healing herb from the Greenmeadow pastures.',
  },

  // --- Consumables (4) ---
  {
    slug: 'lesser-healing-draught',
    name: 'Lesser Healing Draught',
    category: 'CONSUMABLE',
    stackable: true,
    maxStackQuantity: 20,
    hpRestore: 30,
    usableInCombat: true,
    baseValue: 12n,
    description: 'A bitter red tonic that knits small wounds. Restores 30 HP.',
  },
  {
    slug: 'healing-draught',
    name: 'Healing Draught',
    category: 'CONSUMABLE',
    stackable: true,
    maxStackQuantity: 20,
    hpRestore: 80,
    usableInCombat: true,
    baseValue: 30n,
    description: 'A potent restorative brewed from meadow herbs. Restores 80 HP.',
  },
  {
    slug: 'mana-tonic',
    name: 'Mana Tonic',
    category: 'CONSUMABLE',
    stackable: true,
    maxStackQuantity: 20,
    mpRestore: 40,
    usableInCombat: true,
    baseValue: 25n,
    description: 'Cool blue liquid that hums faintly. Restores 40 MP.',
  },
  {
    slug: 'traveler-ration',
    name: "Traveler's Ration",
    category: 'CONSUMABLE',
    stackable: true,
    maxStackQuantity: 30,
    hpRestore: 15,
    usableInCombat: false,
    baseValue: 6n,
    description: 'Hard bread, dried fish, and a strip of salted meat. Restores 15 HP.',
  },

  // --- Equipment (6) ---
  {
    slug: 'bronze-longblade',
    name: 'Bronze Longblade',
    category: 'EQUIPMENT',
    stackable: false,
    equipmentSlot: 'MAIN_HAND',
    levelRequirement: 3,
    bonusStrength: 4,
    baseValue: 120n,
    description: 'A forge-fresh blade of copper-tin bronze with a leather-wrapped grip.',
  },
  {
    slug: 'apprentice-focus',
    name: "Apprentice's Focus",
    category: 'EQUIPMENT',
    stackable: false,
    equipmentSlot: 'MAIN_HAND',
    levelRequirement: 1,
    bonusMagic: 4,
    baseValue: 110n,
    description: 'A polished crystal rod that steadies the mind for spellwork.',
  },
  {
    slug: 'pinewood-buckler',
    name: 'Pinewood Buckler',
    category: 'EQUIPMENT',
    stackable: false,
    equipmentSlot: 'OFF_HAND',
    levelRequirement: 1,
    bonusDefense: 2,
    baseValue: 60n,
    description: 'A small round shield of banded pine. Light but dependable.',
  },
  {
    slug: 'worn-leather-cap',
    name: 'Worn Leather Cap',
    category: 'EQUIPMENT',
    stackable: false,
    equipmentSlot: 'HEAD',
    levelRequirement: 1,
    bonusDefense: 1,
    baseValue: 35n,
    description: 'A scuffed but serviceable cap of boiled leather.',
  },
  {
    slug: 'quilted-tunic',
    name: 'Quilted Tunic',
    category: 'EQUIPMENT',
    stackable: false,
    equipmentSlot: 'BODY',
    levelRequirement: 1,
    bonusDefense: 2,
    bonusMaxHp: 5,
    baseValue: 50n,
    description: 'Layers of stitched wool padding that turn aside glancing blows.',
  },
  {
    slug: 'lucky-riverstone-charm',
    name: 'Lucky Riverstone Charm',
    category: 'EQUIPMENT',
    stackable: false,
    equipmentSlot: 'ACCESSORY_1',
    levelRequirement: 1,
    bonusLuck: 2,
    baseValue: 45n,
    description: 'A smooth stone with a natural hole, threaded on a cord. Fishermen swear by them.',
  },

  // --- Crafting components (3) ---
  {
    slug: 'copper-ingot',
    name: 'Copper Ingot',
    category: 'CRAFTING_COMPONENT',
    stackable: true,
    maxStackQuantity: 50,
    baseValue: 12n,
    description: 'A cast bar of refined copper, ready for the anvil.',
  },
  {
    slug: 'iron-ingot',
    name: 'Iron Ingot',
    category: 'CRAFTING_COMPONENT',
    stackable: true,
    maxStackQuantity: 50,
    baseValue: 20n,
    description: 'A dense bar of smelted iron, the backbone of honest smithing.',
  },
  {
    slug: 'forge-coal',
    name: 'Forge Coal',
    category: 'CRAFTING_COMPONENT',
    stackable: true,
    maxStackQuantity: 99,
    baseValue: 2n,
    description: 'Dense black coal that burns hot enough for smelting.',
  },

  // --- Collectibles (3, museum-eligible artifacts) ---
  {
    slug: 'sunken-crown-fragment',
    name: 'Sunken Crown Fragment',
    category: 'COLLECTIBLE',
    stackable: false,
    baseValue: 200n,
    description: 'A gold shard from the old royal crown, dredged from the harbor silt.',
  },
  {
    slug: 'ancient-trade-seal',
    name: 'Ancient Trade Seal',
    category: 'COLLECTIBLE',
    stackable: false,
    baseValue: 150n,
    description: 'A wax-stained bronze stamp of a merchant house no ledger remembers.',
  },
  {
    slug: 'painted-river-pebble',
    name: 'Painted River Pebble',
    category: 'COLLECTIBLE',
    stackable: true,
    maxStackQuantity: 10,
    baseValue: 90n,
    description: 'A pebble bearing tiny painted figures — older than Crownfall itself.',
  },

  // --- Quest items (2) ---
  {
    slug: 'sealed-courier-letter',
    name: 'Sealed Courier Letter',
    category: 'QUEST_ITEM',
    stackable: false,
    baseValue: 0n,
    description: 'A letter under an unbroken wax seal. Someone is waiting for it.',
  },
  {
    slug: 'wardens-emblem',
    name: "Warden's Emblem",
    category: 'QUEST_ITEM',
    stackable: false,
    baseValue: 0n,
    description: 'A soot-black iron emblem stamped with a hammer and gate.',
  },

  // --- Specialty goods (2) ---
  {
    slug: 'harbor-spice-bundle',
    name: 'Harbor Spice Bundle',
    category: 'SPECIALTY',
    stackable: true,
    maxStackQuantity: 20,
    baseValue: 40n,
    description: 'Cloth-wrapped spices off the trade ships — worth more far from the sea.',
  },
  {
    slug: 'silvermere-pearl',
    name: 'Silvermere Pearl',
    category: 'SPECIALTY',
    stackable: true,
    maxStackQuantity: 20,
    baseValue: 60n,
    description: 'A pale freshwater pearl from the lake beds. Jewelers pay well.',
  },
];

/**
 * Regional price modifiers in basis points (10000 = base value), keyed by
 * location slug and item category. The whole map is defined up front; only
 * locations with implemented shops have active prices today.
 */
export const REGIONAL_PRICE_MODIFIERS = [
  // Market District: broad demand — a modest premium across the board.
  ...[
    'RESOURCE',
    'CONSUMABLE',
    'EQUIPMENT',
    'CRAFTING_COMPONENT',
    'COLLECTIBLE',
    'QUEST_ITEM',
    'SPECIALTY',
  ].map((category) => ({
    locationSlug: 'crownfall-market-district',
    category,
    modifierBps: 10500,
  })),
  // Ironroot Mine: ore is cheap at the source; hauled-in food is dear.
  { locationSlug: 'ironroot-mine', category: 'RESOURCE', modifierBps: 7500 },
  { locationSlug: 'ironroot-mine', category: 'CONSUMABLE', modifierBps: 13000 },
  // Greenmeadow Village: cheap food and herbs; costly metal gear.
  { locationSlug: 'greenmeadow-village', category: 'CONSUMABLE', modifierBps: 8000 },
  { locationSlug: 'greenmeadow-village', category: 'RESOURCE', modifierBps: 9000 },
  { locationSlug: 'greenmeadow-village', category: 'EQUIPMENT', modifierBps: 13000 },
  { locationSlug: 'greenmeadow-village', category: 'CRAFTING_COMPONENT', modifierBps: 12000 },
  // Silvermere Lake: the morning catch goes cheap.
  { locationSlug: 'silvermere-lake', category: 'RESOURCE', modifierBps: 8500 },
  // Crownfall Harbor: specialty imports land here first.
  { locationSlug: 'crownfall-harbor', category: 'SPECIALTY', modifierBps: 9000 },
];

/**
 * NPC shop configurations: weighted restock pools with quantity ranges and
 * per-restock, per-character purchase limits. Sellback rates are strictly
 * below markup so buy-at-NPC/sell-to-NPC can never profit.
 */
export const NPC_SHOPS = [
  {
    slug: 'crownfall-general-goods',
    name: 'Crownfall General Goods',
    locationSlug: 'crownfall-market-district',
    description: 'Staples, supplies, and sundries — restocked in limited batches.',
    markupBps: 12000,
    sellbackBps: 5000,
    restockIntervalSeconds: 1800,
    restockJitterSeconds: 600,
    poolConfig: {
      restockSlots: 5,
      pool: [
        {
          itemSlug: 'lesser-healing-draught',
          weight: 30,
          minQuantity: 5,
          maxQuantity: 10,
          perCharacterLimit: 3,
        },
        {
          itemSlug: 'healing-draught',
          weight: 15,
          minQuantity: 3,
          maxQuantity: 6,
          perCharacterLimit: 2,
        },
        {
          itemSlug: 'mana-tonic',
          weight: 15,
          minQuantity: 3,
          maxQuantity: 6,
          perCharacterLimit: 2,
        },
        {
          itemSlug: 'traveler-ration',
          weight: 25,
          minQuantity: 8,
          maxQuantity: 15,
          perCharacterLimit: 5,
        },
        {
          itemSlug: 'meadow-herb',
          weight: 20,
          minQuantity: 10,
          maxQuantity: 20,
          perCharacterLimit: 10,
        },
        {
          itemSlug: 'forge-coal',
          weight: 20,
          minQuantity: 10,
          maxQuantity: 20,
          perCharacterLimit: 10,
        },
        {
          itemSlug: 'harbor-spice-bundle',
          weight: 8,
          minQuantity: 2,
          maxQuantity: 4,
          perCharacterLimit: 2,
        },
      ],
    },
  },
  {
    slug: 'crownfall-forge',
    name: 'Crownfall Forge',
    locationSlug: 'crownfall-market-district',
    description: 'Smith-made arms and armor in limited supply.',
    markupBps: 12500,
    sellbackBps: 5500,
    restockIntervalSeconds: 2700,
    restockJitterSeconds: 900,
    poolConfig: {
      restockSlots: 4,
      pool: [
        {
          itemSlug: 'bronze-longblade',
          weight: 12,
          minQuantity: 1,
          maxQuantity: 2,
          perCharacterLimit: 1,
        },
        {
          itemSlug: 'pinewood-buckler',
          weight: 20,
          minQuantity: 1,
          maxQuantity: 3,
          perCharacterLimit: 1,
        },
        {
          itemSlug: 'worn-leather-cap',
          weight: 20,
          minQuantity: 1,
          maxQuantity: 3,
          perCharacterLimit: 1,
        },
        {
          itemSlug: 'quilted-tunic',
          weight: 18,
          minQuantity: 1,
          maxQuantity: 3,
          perCharacterLimit: 1,
        },
        {
          itemSlug: 'apprentice-focus',
          weight: 12,
          minQuantity: 1,
          maxQuantity: 2,
          perCharacterLimit: 1,
        },
        {
          itemSlug: 'copper-ingot',
          weight: 25,
          minQuantity: 5,
          maxQuantity: 10,
          perCharacterLimit: 5,
        },
        {
          itemSlug: 'iron-ingot',
          weight: 20,
          minQuantity: 4,
          maxQuantity: 8,
          perCharacterLimit: 4,
        },
      ],
    },
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
  // Phase 23 raised the cap to 30 (strictly increasing deltas).
  { level: 21, cumulativeXp: 43600 },
  { level: 22, cumulativeXp: 49900 },
  { level: 23, cumulativeXp: 56700 },
  { level: 24, cumulativeXp: 64000 },
  { level: 25, cumulativeXp: 71800 },
  { level: 26, cumulativeXp: 80100 },
  { level: 27, cumulativeXp: 88900 },
  { level: 28, cumulativeXp: 98200 },
  { level: 29, cumulativeXp: 108000 },
  { level: 30, cumulativeXp: 118300 },
];

/**
 * Mining actions at Ironroot Mine (Phase 10). Each run draws exactly one
 * weighted entry from its reward table with secure server RNG at start;
 * durations are short enough to feel responsive while still being timed.
 */
export const GATHERING_ACTIONS = [
  {
    slug: 'mine-copper-seam',
    name: 'Mine Copper Seam',
    description: 'Chip green-veined copper from the shallow galleries. Easy, reliable work.',
    skill: 'MINING',
    locationSlug: 'ironroot-mine',
    levelRequirement: 1,
    staminaCost: 2,
    durationSeconds: 12,
    xpReward: 8,
    sortOrder: 1,
    rewardTable: {
      entries: [
        { itemSlug: 'copper-ore', weight: 85, minQuantity: 2, maxQuantity: 4 },
        { itemSlug: 'iron-ore', weight: 15, minQuantity: 1, maxQuantity: 1 },
      ],
    },
  },
  {
    slug: 'mine-iron-vein',
    name: 'Mine Iron Vein',
    description: 'Work the deeper iron veins with pick and wedge. Harder rock, better ore.',
    skill: 'MINING',
    locationSlug: 'ironroot-mine',
    levelRequirement: 2,
    staminaCost: 3,
    durationSeconds: 20,
    xpReward: 12,
    sortOrder: 2,
    rewardTable: {
      entries: [
        { itemSlug: 'iron-ore', weight: 70, minQuantity: 1, maxQuantity: 3 },
        { itemSlug: 'copper-ore', weight: 30, minQuantity: 2, maxQuantity: 3 },
      ],
    },
  },
  {
    slug: 'search-crystal-pocket',
    name: 'Search Crystal Pocket',
    description:
      'Follow the faint glow into stranger seams. Slow, careful work — sometimes it pays.',
    skill: 'MINING',
    locationSlug: 'ironroot-mine',
    levelRequirement: 4,
    staminaCost: 4,
    durationSeconds: 30,
    xpReward: 18,
    sortOrder: 3,
    rewardTable: {
      entries: [
        { itemSlug: 'glimmer-crystal', weight: 40, minQuantity: 1, maxQuantity: 2 },
        { itemSlug: 'iron-ore', weight: 35, minQuantity: 1, maxQuantity: 2 },
        { itemSlug: 'copper-ore', weight: 25, minQuantity: 2, maxQuantity: 4 },
      ],
    },
  },
];

/**
 * Blacksmithing recipes at the Crownfall Forge (Phase 11). Crafting is
 * deterministic: fixed inputs + Gold at start, fixed output at completion —
 * no RNG and no failure chance in this release.
 */
export const CRAFTING_RECIPES = [
  {
    slug: 'smelt-copper-ingot',
    name: 'Smelt Copper Ingot',
    description: 'Roast copper ore over hot coal and cast the melt into a bar mold.',
    profession: 'BLACKSMITHING',
    locationSlug: 'crownfall-market-district',
    levelRequirement: 1,
    goldCost: 2n,
    durationSeconds: 12,
    xpReward: 10,
    sortOrder: 1,
    inputs: [
      { itemSlug: 'copper-ore', quantity: 3 },
      { itemSlug: 'forge-coal', quantity: 1 },
    ],
    outputItemSlug: 'copper-ingot',
    outputQuantity: 1,
  },
  {
    slug: 'smelt-iron-ingot',
    name: 'Smelt Iron Ingot',
    description: 'Iron asks for a hotter fire and a steadier hand than copper.',
    profession: 'BLACKSMITHING',
    locationSlug: 'crownfall-market-district',
    levelRequirement: 2,
    goldCost: 4n,
    durationSeconds: 20,
    xpReward: 14,
    sortOrder: 2,
    inputs: [
      { itemSlug: 'iron-ore', quantity: 3 },
      { itemSlug: 'forge-coal', quantity: 1 },
    ],
    outputItemSlug: 'iron-ingot',
    outputQuantity: 1,
  },
  {
    slug: 'forge-bronze-longblade',
    name: 'Forge Bronze Longblade',
    description: 'Alloy copper with iron at the anvil and draw out a working blade.',
    profession: 'BLACKSMITHING',
    locationSlug: 'crownfall-market-district',
    levelRequirement: 3,
    goldCost: 25n,
    durationSeconds: 40,
    xpReward: 30,
    sortOrder: 3,
    inputs: [
      { itemSlug: 'copper-ingot', quantity: 2 },
      { itemSlug: 'iron-ingot', quantity: 1 },
      { itemSlug: 'forge-coal', quantity: 2 },
    ],
    outputItemSlug: 'bronze-longblade',
    outputQuantity: 1,
  },
];

/**
 * Enemy archetypes (Phase 12). Stats sit against player scale (HP 80-120,
 * attributes 5-15 at low levels). `affinities` are damage-taken multipliers
 * in basis points: 15000 weak, 10000 neutral, 5000 resistant, 0 immune.
 * AI actions are weighted; drops reference real catalog items.
 */
export const ENEMY_DEFINITIONS = [
  {
    slug: 'forest-slime',
    name: 'Forest Slime',
    description: 'A quivering green mass that pools in Blackwood hollows. Burns well.',
    level: 1,
    maxHp: 26,
    maxMp: 0,
    strength: 8,
    agility: 5,
    magic: 3,
    defense: 5,
    magicDefense: 10,
    luck: 3,
    ranged: false,
    affinities: { FLAME: 15000, FROST: 10000, STORM: 10000, STONE: 5000 },
    aiConfig: {
      actions: [
        { kind: 'ATTACK', name: 'Slam', weight: 75 },
        {
          kind: 'STATUS',
          name: 'Acrid Spittle',
          status: 'POISON',
          magnitude: 3,
          turns: 3,
          weight: 25,
        },
      ],
    },
    rewardConfig: {
      xp: 9,
      goldMin: 2,
      goldMax: 5,
      drops: [{ itemSlug: 'meadow-herb', chanceBps: 2500, minQuantity: 1, maxQuantity: 1 }],
    },
  },
  {
    slug: 'briar-wolf',
    name: 'Briar Wolf',
    description: 'A lean pack hunter with thorn-matted fur and no fear of lanterns.',
    level: 2,
    maxHp: 34,
    maxMp: 0,
    strength: 11,
    agility: 12,
    magic: 3,
    defense: 6,
    magicDefense: 6,
    luck: 6,
    ranged: false,
    affinities: { FLAME: 15000, FROST: 10000, STORM: 10000, STONE: 10000 },
    aiConfig: {
      actions: [
        { kind: 'ATTACK', name: 'Bite', weight: 70 },
        { kind: 'PHYSICAL', name: 'Lunging Snap', powerBps: 13000, weight: 30 },
      ],
    },
    rewardConfig: {
      xp: 16,
      goldMin: 4,
      goldMax: 8,
      drops: [
        { itemSlug: 'traveler-ration', chanceBps: 1500, minQuantity: 1, maxQuantity: 1 },
        { itemSlug: 'painted-river-pebble', chanceBps: 800, minQuantity: 1, maxQuantity: 1 },
      ],
    },
  },
  {
    slug: 'roadside-bandit',
    name: 'Roadside Bandit',
    description: 'A hedge-country cutpurse working the North Road with a notched blade.',
    level: 2,
    maxHp: 32,
    maxMp: 0,
    strength: 10,
    agility: 9,
    magic: 4,
    defense: 7,
    magicDefense: 6,
    luck: 7,
    ranged: false,
    affinities: { FLAME: 10000, FROST: 10000, STORM: 10000, STONE: 10000 },
    aiConfig: {
      actions: [
        { kind: 'ATTACK', name: 'Slash', weight: 80 },
        { kind: 'PHYSICAL', name: 'Dirty Jab', powerBps: 12000, weight: 20 },
      ],
    },
    rewardConfig: {
      xp: 16,
      goldMin: 8,
      goldMax: 15,
      drops: [
        { itemSlug: 'lesser-healing-draught', chanceBps: 2000, minQuantity: 1, maxQuantity: 1 },
      ],
    },
  },
  {
    slug: 'cave-beetle',
    name: 'Cave Beetle',
    description: 'A dog-sized beetle with a chitin shell that turns picks and blades alike.',
    level: 2,
    maxHp: 30,
    maxMp: 0,
    strength: 9,
    agility: 5,
    magic: 2,
    defense: 12,
    magicDefense: 4,
    luck: 3,
    ranged: false,
    affinities: { FLAME: 10000, FROST: 10000, STORM: 15000, STONE: 5000 },
    aiConfig: {
      actions: [{ kind: 'ATTACK', name: 'Mandible Crush', weight: 100 }],
    },
    rewardConfig: {
      xp: 13,
      goldMin: 3,
      goldMax: 6,
      drops: [{ itemSlug: 'copper-ore', chanceBps: 3000, minQuantity: 1, maxQuantity: 2 }],
    },
  },
  {
    slug: 'ember-bat',
    name: 'Ember Bat',
    description: 'A cinder-winged bat that spits sparks from the high galleries.',
    level: 2,
    maxHp: 24,
    maxMp: 20,
    strength: 7,
    agility: 13,
    magic: 10,
    defense: 4,
    magicDefense: 9,
    luck: 6,
    ranged: true,
    affinities: { FLAME: 0, FROST: 15000, STORM: 10000, STONE: 10000 },
    aiConfig: {
      actions: [
        { kind: 'ATTACK', name: 'Wing Rake', weight: 50 },
        { kind: 'SPELL', name: 'Ember Breath', element: 'FLAME', powerBps: 12000, weight: 50 },
      ],
    },
    rewardConfig: {
      xp: 14,
      goldMin: 3,
      goldMax: 7,
      drops: [{ itemSlug: 'forge-coal', chanceBps: 2500, minQuantity: 1, maxQuantity: 2 }],
    },
  },
  {
    slug: 'ironhide-boar',
    name: 'Ironhide Boar',
    description:
      'An elite terror of the deep Blackwood: a boar plated in bark-hard hide, tusks like plow blades.',
    level: 4,
    maxHp: 90,
    maxMp: 0,
    strength: 15,
    agility: 7,
    magic: 3,
    defense: 14,
    magicDefense: 7,
    luck: 4,
    ranged: false,
    affinities: { FLAME: 10000, FROST: 15000, STORM: 10000, STONE: 5000 },
    aiConfig: {
      actions: [
        { kind: 'ATTACK', name: 'Gore', weight: 60 },
        {
          kind: 'PHYSICAL',
          name: 'Tusk Rush',
          powerBps: 15000,
          weight: 40,
          applies: { status: 'STUN', magnitude: 1, turns: 1, chanceBps: 3000 },
        },
      ],
    },
    rewardConfig: {
      xp: 60,
      goldMin: 15,
      goldMax: 25,
      drops: [{ itemSlug: 'iron-ore', chanceBps: 5000, minQuantity: 1, maxQuantity: 2 }],
    },
  },
  {
    slug: 'warden-of-the-hollow-forge',
    name: 'Warden of the Hollow Forge',
    description:
      'A forgotten guardian of slag and iron that stokes a dead forge deep beneath the mine. It does not permit retreat.',
    level: 6,
    maxHp: 220,
    maxMp: 40,
    strength: 17,
    agility: 8,
    magic: 14,
    defense: 12,
    magicDefense: 12,
    luck: 6,
    ranged: false,
    affinities: { FLAME: 0, FROST: 15000, STORM: 10000, STONE: 5000 },
    aiConfig: {
      actions: [
        { kind: 'ATTACK', name: 'Slag Fist', weight: 40 },
        { kind: 'SPELL', name: 'Forge Flame', element: 'FLAME', powerBps: 14000, weight: 35 },
        {
          kind: 'STATUS',
          name: 'Sundering Clang',
          status: 'ARMOR_BREAK',
          magnitude: 3000,
          turns: 3,
          weight: 25,
        },
      ],
    },
    rewardConfig: {
      xp: 150,
      goldMin: 80,
      goldMax: 120,
      drops: [{ itemSlug: 'glimmer-crystal', chanceBps: 10000, minQuantity: 2, maxQuantity: 2 }],
    },
  },
];

/**
 * Encounters per combat location. The boss is instanced from Ironroot Mine
 * and gated on character level 5 plus a recorded victory over the Ironhide
 * Boar elite.
 */
export const ENCOUNTER_DEFINITIONS = [
  {
    slug: 'slime-hollow',
    name: 'Slime Hollow',
    description: 'Two forest slimes pool across the path, hissing faintly.',
    locationSlug: 'blackwood-forest',
    kind: 'NORMAL',
    fleeable: true,
    fleeModifierBps: 1000,
    composition: [
      { enemySlug: 'forest-slime', row: 'FRONT' },
      { enemySlug: 'forest-slime', row: 'FRONT' },
    ],
    sortOrder: 1,
  },
  {
    slug: 'briar-wolf-pack',
    name: 'Briar Wolf Pack',
    description: 'Yellow eyes circle the lantern light — the pack has your scent.',
    locationSlug: 'blackwood-forest',
    kind: 'NORMAL',
    fleeable: true,
    fleeModifierBps: -500,
    composition: [
      { enemySlug: 'briar-wolf', row: 'FRONT' },
      { enemySlug: 'briar-wolf', row: 'FRONT' },
    ],
    sortOrder: 2,
  },
  {
    slug: 'ironhide-boar',
    name: 'The Ironhide Boar',
    description: 'The underbrush splinters. Something plated and furious wants you gone.',
    locationSlug: 'blackwood-forest',
    kind: 'ELITE',
    fleeable: true,
    fleeModifierBps: -1500,
    composition: [{ enemySlug: 'ironhide-boar', row: 'FRONT' }],
    sortOrder: 3,
  },
  {
    slug: 'roadside-ambush',
    name: 'Roadside Ambush',
    description: 'Two bandits step out of the hedgerows with drawn steel and bad intentions.',
    locationSlug: 'north-road',
    kind: 'NORMAL',
    fleeable: true,
    fleeModifierBps: 500,
    composition: [
      { enemySlug: 'roadside-bandit', row: 'FRONT' },
      { enemySlug: 'roadside-bandit', row: 'FRONT' },
    ],
    sortOrder: 1,
  },
  {
    slug: 'beetle-warren',
    name: 'Beetle Warren',
    description: 'Chitin scrapes on stone in the dark of the lower galleries.',
    locationSlug: 'ironroot-mine',
    kind: 'NORMAL',
    fleeable: true,
    fleeModifierBps: 0,
    composition: [
      { enemySlug: 'cave-beetle', row: 'FRONT' },
      { enemySlug: 'cave-beetle', row: 'FRONT' },
    ],
    sortOrder: 1,
  },
  {
    slug: 'ember-roost',
    name: 'Ember Roost',
    description: 'Sparks drift from the ceiling — the bats roost high and spit fire from range.',
    locationSlug: 'ironroot-mine',
    kind: 'NORMAL',
    fleeable: true,
    fleeModifierBps: 0,
    composition: [
      { enemySlug: 'ember-bat', row: 'BACK' },
      { enemySlug: 'ember-bat', row: 'BACK' },
    ],
    sortOrder: 2,
  },
  {
    slug: 'warden-of-the-hollow-forge',
    name: 'Warden of the Hollow Forge',
    description:
      'A sealed shaft exhales furnace heat. Only a proven hunter should descend — and none may flee.',
    locationSlug: 'ironroot-mine',
    kind: 'BOSS',
    fleeable: false,
    fleeModifierBps: 0,
    composition: [{ enemySlug: 'warden-of-the-hollow-forge', row: 'FRONT' }],
    unlockRequirements: {
      minCharacterLevel: 5,
      requiresVictoryOverEncounterSlug: 'ironhide-boar',
    },
    sortOrder: 3,
  },
];

/**
 * Quests (Phase 13): one each for travel, mining, crafting, combat, and the
 * museum collection. Progress is event-driven and starts only after
 * acceptance; the collection quest completes once donations exist (Phase 14).
 */
export const QUEST_DEFINITIONS = [
  {
    slug: 'errand-to-the-market',
    name: 'Errand to the Market',
    description:
      'The Crownfall clerks need a runner. Walk the short road to the Market District and report in.',
    rewardXp: 30,
    rewardGold: 15n,
    rewardItems: [],
    sortOrder: 1,
    objectives: [
      {
        sortOrder: 1,
        type: 'TRAVEL_TO_LOCATION',
        targetSlug: 'crownfall-market-district',
        requiredCount: 1,
        description: 'Travel to the Crownfall Market District.',
      },
    ],
  },
  {
    slug: 'copper-for-the-forges',
    name: 'Copper for the Forges',
    description:
      'The Market District forge is hungry for ore. Work the Ironroot copper seams until your pack rings with it.',
    rewardXp: 40,
    rewardGold: 25n,
    rewardItems: [{ itemSlug: 'forge-coal', quantity: 2 }],
    sortOrder: 2,
    objectives: [
      {
        sortOrder: 1,
        type: 'GATHER_ITEM',
        targetSlug: 'copper-ore',
        requiredCount: 6,
        description: 'Mine 6 Copper Ore at Ironroot Mine.',
      },
    ],
  },
  {
    slug: 'prove-your-metal',
    name: 'Prove Your Metal',
    description:
      'Any hand can swing a pick. The forge masters want proof you can finish the job at the anvils.',
    rewardXp: 50,
    rewardGold: 30n,
    rewardItems: [],
    sortOrder: 3,
    objectives: [
      {
        sortOrder: 1,
        type: 'CRAFT_RECIPE',
        targetSlug: 'smelt-copper-ingot',
        requiredCount: 2,
        description: 'Smelt 2 Copper Ingots at the Crownfall Forge.',
      },
    ],
  },
  {
    slug: 'thin-the-hollow',
    name: 'Thin the Hollow',
    description:
      'The slimes are pooling thick along the Blackwood paths again. Cull them before the wagons stop running.',
    rewardXp: 60,
    rewardGold: 40n,
    rewardItems: [{ itemSlug: 'lesser-healing-draught', quantity: 1 }],
    sortOrder: 4,
    objectives: [
      {
        sortOrder: 1,
        type: 'DEFEAT_ENEMY',
        targetSlug: 'forest-slime',
        requiredCount: 3,
        description: 'Defeat 3 Forest Slimes in Blackwood Forest.',
      },
    ],
  },
  {
    slug: 'a-gift-for-the-museum',
    name: 'A Gift for the Museum',
    description:
      'The Museum of Regional Artifacts seeks a Sunken Crown Fragment for the permanent collection. Donations open soon.',
    rewardXp: 80,
    rewardGold: 50n,
    rewardItems: [],
    sortOrder: 5,
    objectives: [
      {
        sortOrder: 1,
        type: 'DONATE_ITEM',
        targetSlug: 'sunken-crown-fragment',
        requiredCount: 1,
        description: 'Donate a Sunken Crown Fragment to the museum.',
      },
    ],
  },
];

/**
 * Museum collections (Phase 14): the Regional Artifacts collection at the
 * Crownfall City museum. Exactly the three COLLECTIBLE catalog items are
 * eligible; only the first donation of each entry counts per character.
 */
export const COLLECTION_DEFINITIONS = [
  {
    slug: 'regional-artifacts',
    name: 'Regional Artifacts',
    description:
      'The permanent collection of the Museum of Regional Artifacts: relics of the crown, the trade houses, and the river peoples.',
    locationSlug: 'crownfall-city',
    sortOrder: 1,
    entries: [
      {
        itemSlug: 'sunken-crown-fragment',
        sortOrder: 1,
        curatorNote:
          'Believed lost when the royal barge foundered. The museum is honored to hold a piece of the old crown.',
      },
      {
        itemSlug: 'ancient-trade-seal',
        sortOrder: 2,
        curatorNote:
          'The mark of a merchant house that once moved half the harbor. Its ledgers are dust; its seal endures.',
      },
      {
        itemSlug: 'painted-river-pebble',
        sortOrder: 3,
        curatorNote:
          'The river peoples painted their histories on stones. Each figure is a season; each stone, a life.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Phase 26 — named NPCs and placement schedules (living world, increment 2).
// Original characters. Availability is computed from the world-time segment.
// ---------------------------------------------------------------------------

export const NPC_DEFINITIONS = [
  {
    key: 'brannic-hearthkeeper',
    name: 'Brannic Hearthkeeper',
    pronouns: 'he/him',
    shortDescription: 'The broad-shouldered keeper of the Crownfall hearth.',
    longDescription:
      'Brannic has kept a fire and a kettle going in Crownfall for longer than most can remember. He greets every traveler by the mud on their boots and remembers every name twice.',
    roles: ['INNKEEPER'],
    tags: ['crownfall', 'hospitality'],
    portraitAssetKey: 'npc-portrait-brannic',
    sceneAssetKey: null,
    homeRegion: 'crownfall',
    serviceType: 'INN',
    serviceRef: null,
    dialogueKey: null,
  },
  {
    key: 'mira-coinwright',
    name: 'Mira Coinwright',
    pronouns: 'she/her',
    shortDescription: 'A sharp-eyed trader who never forgets a face or a debt.',
    longDescription:
      'Mira runs the busiest stall in the market district. She can price a strange trinket in a heartbeat and haggles for the sport of it more than the coin.',
    roles: ['MERCHANT'],
    tags: ['crownfall', 'market'],
    portraitAssetKey: 'npc-portrait-mira',
    sceneAssetKey: null,
    homeRegion: 'crownfall',
    serviceType: 'SHOP',
    serviceRef: 'crownfall-general-goods',
    dialogueKey: 'mira-welcome',
  },
  {
    key: 'old-tomas-dockhand',
    name: 'Old Tomas',
    pronouns: 'he/him',
    shortDescription: 'A weathered dockhand who works the harbor by day.',
    longDescription:
      'Tomas has hauled rope and crate along the Crownfall harbor since he was a boy. When the light fails he retires to warmer rooms, leaving the wharf to the gulls.',
    roles: ['WORKER', 'TRAVELER'],
    tags: ['crownfall', 'harbor'],
    portraitAssetKey: 'npc-portrait-tomas',
    sceneAssetKey: null,
    homeRegion: 'crownfall',
    serviceType: 'NONE',
    serviceRef: null,
    dialogueKey: null,
  },
  {
    key: 'serel-the-scholar',
    name: 'Serel of the Archive',
    pronouns: 'they/them',
    shortDescription: 'A quiet scholar cataloguing the city at first light.',
    longDescription:
      'Serel keeps the early hours, when the streets are still and the reading is good. They trade rumors for facts and consider it a fair exchange.',
    roles: ['SCHOLAR'],
    tags: ['crownfall', 'lore'],
    portraitAssetKey: 'npc-portrait-serel',
    sceneAssetKey: null,
    homeRegion: 'crownfall',
    serviceType: 'NONE',
    serviceRef: null,
    dialogueKey: null,
  },
  {
    key: 'captain-yorwen',
    name: 'Captain Yorwen',
    pronouns: 'she/her',
    shortDescription: 'The harbor watch captain, on duty at all hours.',
    longDescription:
      'Yorwen commands the harbor watch and takes the night shifts herself as often as not. She trusts the tide more than she trusts strangers.',
    roles: ['GUARD'],
    tags: ['crownfall', 'harbor', 'watch'],
    portraitAssetKey: 'npc-portrait-yorwen',
    sceneAssetKey: null,
    homeRegion: 'crownfall',
    serviceType: 'NONE',
    serviceRef: null,
    dialogueKey: null,
  },
  {
    key: 'greta-fieldwarden',
    name: 'Greta Fieldwarden',
    pronouns: 'she/her',
    shortDescription: 'A village warden watching the Greenmeadow rows.',
    longDescription:
      'Greta walks the meadow fences from midday to dusk, mending what the season breaks and warning off what the season brings down from the hills.',
    roles: ['GUARD', 'WORKER'],
    tags: ['northmarch', 'greenmeadow'],
    portraitAssetKey: 'npc-portrait-greta',
    sceneAssetKey: null,
    homeRegion: 'northmarch',
    serviceType: 'NONE',
    serviceRef: null,
    dialogueKey: null,
  },
  {
    key: 'wandering-pell',
    name: 'Wandering Pell',
    pronouns: 'they/them',
    shortDescription: 'A traveler who takes the north road each morning.',
    longDescription:
      'Pell keeps no fixed home. They wake in Greenmeadow and are on the north road by midday, trading small news between the two for the pleasure of the walk.',
    roles: ['TRAVELER'],
    tags: ['northmarch', 'road'],
    portraitAssetKey: 'npc-portrait-pell',
    sceneAssetKey: null,
    homeRegion: 'northmarch',
    serviceType: 'NONE',
    serviceRef: null,
    dialogueKey: null,
  },
  {
    key: 'delve-foreman-oxley',
    name: 'Foreman Oxley',
    pronouns: 'he/him',
    shortDescription: 'The gruff foreman of the Ironroot dig.',
    longDescription:
      'Oxley runs the Ironroot shifts and knows every timber and fault by feel. He measures a person by whether they respect the dark.',
    roles: ['WORKER'],
    tags: ['deepvale', 'mine'],
    portraitAssetKey: 'npc-portrait-oxley',
    sceneAssetKey: null,
    homeRegion: 'deepvale',
    serviceType: 'NONE',
    serviceRef: null,
    dialogueKey: null,
  },
];

export const NPC_PLACEMENTS = [
  {
    npcKey: 'brannic-hearthkeeper',
    locationSlug: 'crownfall-city',
    segments: ['DAWN', 'DAY', 'DUSK', 'NIGHT'],
    priority: 10,
    visibility: 'PUBLIC',
  },
  {
    npcKey: 'mira-coinwright',
    locationSlug: 'crownfall-market-district',
    segments: ['DAWN', 'DAY', 'DUSK', 'NIGHT'],
    priority: 10,
    visibility: 'PUBLIC',
  },
  {
    npcKey: 'old-tomas-dockhand',
    locationSlug: 'crownfall-harbor',
    segments: ['DAY', 'DUSK'],
    priority: 5,
    visibility: 'PUBLIC',
  },
  {
    npcKey: 'serel-the-scholar',
    locationSlug: 'crownfall-city',
    segments: ['DAWN', 'DAY'],
    priority: 3,
    visibility: 'PUBLIC',
  },
  {
    npcKey: 'captain-yorwen',
    locationSlug: 'crownfall-harbor',
    segments: ['DAWN', 'DAY', 'DUSK', 'NIGHT'],
    priority: 8,
    visibility: 'PUBLIC',
  },
  {
    npcKey: 'greta-fieldwarden',
    locationSlug: 'greenmeadow-village',
    segments: ['DAY', 'DUSK'],
    priority: 5,
    visibility: 'PUBLIC',
  },
  // Relocation: Pell wakes in Greenmeadow, then walks the north road by day.
  {
    npcKey: 'wandering-pell',
    locationSlug: 'greenmeadow-village',
    segments: ['DAWN'],
    priority: 2,
    visibility: 'PUBLIC',
  },
  {
    npcKey: 'wandering-pell',
    locationSlug: 'north-road',
    segments: ['DAY', 'DUSK'],
    priority: 2,
    visibility: 'PUBLIC',
  },
  {
    npcKey: 'delve-foreman-oxley',
    locationSlug: 'ironroot-mine',
    segments: ['DAY', 'DUSK'],
    priority: 4,
    visibility: 'PUBLIC',
  },
];

// ---------------------------------------------------------------------------
// Phase 26 — dialogue and narrative flags (living world, increment 3).
// ---------------------------------------------------------------------------

export const NARRATIVE_FLAGS = [
  {
    key: 'mira-greeted',
    namespace: 'mira',
    valueType: 'BOOLEAN',
    allowedValues: ['false', 'true'],
    defaultValue: 'false',
  },
  {
    key: 'mira-gift-given',
    namespace: 'mira',
    valueType: 'BOOLEAN',
    allowedValues: ['false', 'true'],
    defaultValue: 'false',
  },
];

export const DIALOGUES = [
  {
    key: 'mira-welcome',
    entryNodeId: 'greet',
    npcKey: 'mira-coinwright',
    nodes: [
      {
        id: 'greet',
        speaker: 'NPC',
        text: "Mira looks up from her ledger. 'A new face! What can I do for you?'",
        choices: [
          {
            id: 'about',
            label: 'Tell me about your wares.',
            conditions: [],
            effects: [
              { type: 'SET_FLAG', flagKey: 'mira-greeted', value: 'true' },
              { type: 'INCREMENT_FAMILIARITY', amount: 5 },
            ],
            to: 'wares',
          },
          {
            id: 'news',
            label: 'Heard any news?',
            conditions: [],
            effects: [{ type: 'EMIT_QUEST_EVENT' }],
            to: 'news',
          },
          {
            id: 'gift',
            label: 'You look generous today.',
            conditions: [{ type: 'FLAG_EQUALS', flagKey: 'mira-gift-given', value: 'false' }],
            effects: [
              { type: 'GRANT_GOLD', amount: '10' },
              { type: 'SET_FLAG', flagKey: 'mira-gift-given', value: 'true' },
            ],
            to: 'gift',
          },
          {
            id: 'veteran',
            label: 'Talk shop, trader to trader.',
            conditions: [{ type: 'LEVEL_AT_LEAST', minLevel: 5 }],
            effects: [],
            to: 'shoptalk',
          },
          { id: 'leave', label: 'Just passing through.', conditions: [], effects: [], to: null },
        ],
      },
      {
        id: 'wares',
        speaker: 'NPC',
        text: "'Finest goods this side of the harbor. Try not to haggle too hard.'",
        choices: [{ id: 'back-w', label: 'Thanks.', conditions: [], effects: [], to: null }],
      },
      {
        id: 'news',
        speaker: 'NPC',
        text: "'They say the harbor watch doubled the night patrol. Storms, or worse.'",
        choices: [{ id: 'back-n', label: 'Interesting.', conditions: [], effects: [], to: null }],
      },
      {
        id: 'gift',
        speaker: 'NPC',
        text: "She flicks a coin your way. 'First one's on me. Don't spend it all.'",
        choices: [{ id: 'back-g', label: 'Much obliged.', conditions: [], effects: [], to: null }],
      },
      {
        id: 'shoptalk',
        speaker: 'NPC',
        text: "'A seasoned trader, eh? Then you know margins are everything.'",
        choices: [{ id: 'back-s', label: 'Indeed.', conditions: [], effects: [], to: null }],
      },
    ],
  },
];
