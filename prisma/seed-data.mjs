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
    stackable: false,
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
