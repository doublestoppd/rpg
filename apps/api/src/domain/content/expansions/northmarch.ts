import type { ContentDefinitionEntry, ContentType } from '@rpg/shared';

/**
 * The Northmarch expansion (Phase 22) as versioned content definitions. This is
 * *data*, not gameplay code: it is published through the content platform
 * (draft → validate → publish → apply-on-publish), exactly like content an
 * administrator authors in the Studio. The only Phase 22 code changes are the
 * new Herbalism (gathering) and Alchemy (crafting) professions the engine now
 * understands; every location, item, recipe, enemy, encounter, quest, shop, and
 * collection below is ordinary content.
 *
 * References may point at existing world content (e.g. the `north-road`
 * gateway), because the published release is the live content plus these
 * additions, so every reference resolves in-bundle.
 */

const REGION = 'northmarch';
const defs: ContentDefinitionEntry[] = [];
const add = (type: ContentType, key: string, payload: Record<string, unknown>): void => {
  defs.push({ type, key, revision: 1, payload });
};

// --- items -----------------------------------------------------------------

interface ItemOpts {
  category: string;
  baseValue: number;
  stackable?: boolean;
  maxStackQuantity?: number;
  hpRestore?: number;
  mpRestore?: number;
  usableInCombat?: boolean;
}
function item(slug: string, name: string, description: string, o: ItemOpts): void {
  add('ITEM', slug, {
    slug,
    name,
    description,
    category: o.category,
    stackable: o.stackable ?? true,
    maxStackQuantity: o.maxStackQuantity ?? 99,
    equipmentSlot: null,
    levelRequirement: 1,
    bonusStrength: 0,
    bonusAgility: 0,
    bonusMagic: 0,
    bonusDefense: 0,
    bonusMagicDefense: 0,
    bonusLuck: 0,
    bonusMaxHp: 0,
    bonusMaxMp: 0,
    hpRestore: o.hpRestore ?? 0,
    mpRestore: o.mpRestore ?? 0,
    usableInCombat: o.usableInCombat ?? false,
    baseValue: String(o.baseValue),
  });
}

// Herbs and reagents (gathered / refined).
item(
  'frostbell-blossom',
  'Frostbell Blossom',
  'A pale bell-flower that rimes with frost even in summer.',
  { category: 'RESOURCE', baseValue: 10 },
);
item('emberleaf', 'Emberleaf', 'A red-veined leaf warm to the touch; smoulders when crushed.', {
  category: 'RESOURCE',
  baseValue: 11,
});
item('mirebloom', 'Mirebloom', 'A waxy fen-flower prized by tonic-brewers for its clarity.', {
  category: 'RESOURCE',
  baseValue: 14,
});
item('hollow-root', 'Hollow Root', 'A hollow, whistling root pulled from the thicket floor.', {
  category: 'RESOURCE',
  baseValue: 16,
});
item(
  'spring-water-vial',
  'Spring-Water Vial',
  'Clean fen-spring water, the base of every Northmarch draught.',
  { category: 'CRAFTING_COMPONENT', baseValue: 6 },
);
item('crushed-quartz', 'Crushed Quartz', 'Glittering quartz grit that fixes a potion’s potency.', {
  category: 'CRAFTING_COMPONENT',
  baseValue: 15,
});
item(
  'distilled-essence',
  'Distilled Essence',
  'A concentrated herbal distillate, half-way to a finished philter.',
  { category: 'CRAFTING_COMPONENT', baseValue: 28 },
);

// Alchemy consumables (crafted / sold).
item(
  'minor-healing-elixir',
  'Minor Healing Elixir',
  'A green draught that knits small wounds. Usable in a pinch.',
  { category: 'CONSUMABLE', baseValue: 34, hpRestore: 40, usableInCombat: true },
);
item(
  'greater-healing-elixir',
  'Greater Healing Elixir',
  'A double-distilled restorative for hard fights.',
  { category: 'CONSUMABLE', baseValue: 96, hpRestore: 110, usableInCombat: true },
);
item(
  'frost-ward-tonic',
  'Frost-Ward Tonic',
  'A bitter blue tonic that steadies the nerves against the cold.',
  { category: 'CONSUMABLE', baseValue: 44, hpRestore: 20, usableInCombat: true },
);
item('ember-draught', 'Ember Draught', 'A warming draught that restores a little vigor.', {
  category: 'CONSUMABLE',
  baseValue: 40,
  hpRestore: 25,
  usableInCombat: true,
});
item(
  'clarity-philter',
  'Clarity Philter',
  'A luminous philter that clears the head and restores focus.',
  { category: 'CONSUMABLE', baseValue: 60, mpRestore: 30, usableInCombat: true },
);

// Collectibles (the Northmarch relic set) and a quest item.
item(
  'wyrm-scale-sigil',
  'Wyrm-Scale Sigil',
  'A sigil cut from a fen-wyrm’s scale; cold and faintly iridescent.',
  { category: 'COLLECTIBLE', baseValue: 220, maxStackQuantity: 5 },
);
item(
  'barrow-lantern',
  'Barrow Lantern',
  'A guttering lantern recovered from the Wyrmwatch barrows.',
  { category: 'COLLECTIBLE', baseValue: 180, maxStackQuantity: 5 },
);
item(
  'fen-witch-charm',
  'Fen-Witch Charm',
  'A knot of reeds and bone once worn by the fen-witches.',
  { category: 'COLLECTIBLE', baseValue: 160, maxStackQuantity: 5 },
);
item(
  'sealed-warden-orders',
  'Sealed Warden Orders',
  'Orders under the Warden’s seal, to be carried to the Hold.',
  { category: 'QUEST_ITEM', baseValue: 0, maxStackQuantity: 5 },
);

// --- locations, routes, features ------------------------------------------

function location(slug: string, name: string, description: string, isSafe: boolean): void {
  add('LOCATION', slug, {
    slug,
    name,
    region: REGION,
    description,
    artworkKey: `locations/${slug}`,
    isSafe,
  });
}
function route(from: string, to: string, seconds: number, gold = 0): void {
  const body = { travelSeconds: seconds, goldCost: String(gold) };
  add('TRAVEL_ROUTE', `${from}->${to}`, { fromSlug: from, toSlug: to, ...body });
  add('TRAVEL_ROUTE', `${to}->${from}`, { fromSlug: to, toSlug: from, ...body });
}
function feature(
  locationSlug: string,
  type: string,
  name: string,
  description: string,
  sortOrder: number,
): void {
  add('LOCATION_FEATURE', `${locationSlug}:${type}:${name}`, {
    locationSlug,
    type,
    name,
    description,
    sortOrder,
  });
}
function priceModifier(locationSlug: string, category: string, modifierBps: number): void {
  add('REGIONAL_PRICE_MODIFIER', `${locationSlug}:${category}`, {
    locationSlug,
    category,
    modifierBps,
  });
}

location(
  'northmarch-hold',
  'Northmarch Hold',
  'The walled seat of the Warden, and the last hot meal before the fens.',
  true,
);
location(
  'frostmere-fen',
  'Frostmere Fen',
  'A cold marsh of rime-flowers and sucking mud, loud with unseen things.',
  false,
);
location(
  'hollowpine-thicket',
  'Hollowpine Thicket',
  'A dense stand of whistling pines where the light goes green and thin.',
  false,
);
location(
  'wyrmwatch-barrow',
  'Wyrmwatch Barrow',
  'Ancient grave-mounds above the fen, where something old keeps watch.',
  false,
);

// The Hold hangs off the existing North Road; the wilds hang off the Hold.
route('north-road', 'northmarch-hold', 70);
route('northmarch-hold', 'frostmere-fen', 60);
route('northmarch-hold', 'hollowpine-thicket', 55);
route('frostmere-fen', 'wyrmwatch-barrow', 80);
route('hollowpine-thicket', 'wyrmwatch-barrow', 85);

feature(
  'northmarch-hold',
  'INN',
  'The Warden’s Rest',
  'A low, warm common-room where the fire never quite goes out.',
  1,
);
feature(
  'northmarch-hold',
  'MARKETPLACE',
  'Northmarch Exchange',
  'Player stalls trading fen-herbs, tonics, and barrow-finds.',
  2,
);
feature(
  'northmarch-hold',
  'NPC_SHOP',
  'The Provisioner',
  'Staples and travelers’ supplies for the road north.',
  3,
);
feature(
  'northmarch-hold',
  'NPC_SHOP',
  'The Apothecary',
  'Reagents and finished draughts, sold by weight.',
  4,
);
feature(
  'northmarch-hold',
  'CRAFTING',
  'Alchemist’s Lab',
  'Alembics and cold-tables for brewing Northmarch philters.',
  5,
);
feature(
  'northmarch-hold',
  'QUEST',
  'Warden’s Notice Board',
  'Bounties and errands posted under the Warden’s seal.',
  6,
);
feature(
  'northmarch-hold',
  'MUSEUM',
  'Hall of Northern Relics',
  'A quiet hall of barrow-finds and fen-witch curios.',
  7,
);
feature(
  'frostmere-fen',
  'GATHERING',
  'Fenherb Cuttings',
  'Cold-weather herbs for those who know where to cut.',
  1,
);
feature('frostmere-fen', 'COMBAT', 'Fen Prowlers', 'The fen’s hunters do not care for company.', 2);
feature(
  'hollowpine-thicket',
  'GATHERING',
  'Thicket Foraging',
  'Roots and leaves under the whistling pines.',
  1,
);
feature(
  'hollowpine-thicket',
  'COMBAT',
  'Thicket Stalkers',
  'Something is always watching from the green dark.',
  2,
);
feature(
  'wyrmwatch-barrow',
  'COMBAT',
  'The Barrow Vigil',
  'The mounds do not welcome the living.',
  1,
);

priceModifier('northmarch-hold', 'CONSUMABLE', 11000); // draughts fetch more this far north
priceModifier('northmarch-hold', 'RESOURCE', 9000); // fen-herbs are cheap at the source
priceModifier('frostmere-fen', 'RESOURCE', 8500);
priceModifier('hollowpine-thicket', 'RESOURCE', 8500);

// --- herbalism gathering ---------------------------------------------------

interface GatherReward {
  itemSlug: string;
  weight: number;
  minQuantity: number;
  maxQuantity: number;
}
function gather(
  slug: string,
  name: string,
  description: string,
  locationSlug: string,
  levelRequirement: number,
  staminaCost: number,
  durationSeconds: number,
  xpReward: number,
  sortOrder: number,
  entries: GatherReward[],
): void {
  add('GATHERING_ACTION', slug, {
    slug,
    name,
    description,
    skill: 'HERBALISM',
    locationSlug,
    levelRequirement,
    staminaCost,
    durationSeconds,
    xpReward,
    rewardTable: { entries },
    sortOrder,
  });
}

gather(
  'gather-frostbell',
  'Cut Frostbell',
  'Cut rime-flowers from the fen margins.',
  'frostmere-fen',
  1,
  2,
  12,
  8,
  1,
  [
    { itemSlug: 'frostbell-blossom', weight: 80, minQuantity: 2, maxQuantity: 4 },
    { itemSlug: 'spring-water-vial', weight: 20, minQuantity: 1, maxQuantity: 1 },
  ],
);
gather(
  'gather-mirebloom',
  'Gather Mirebloom',
  'Wade the shallows for waxy mireblooms.',
  'frostmere-fen',
  2,
  3,
  18,
  12,
  2,
  [
    { itemSlug: 'mirebloom', weight: 78, minQuantity: 1, maxQuantity: 3 },
    { itemSlug: 'frostbell-blossom', weight: 22, minQuantity: 1, maxQuantity: 1 },
  ],
);
gather(
  'gather-emberleaf',
  'Pick Emberleaf',
  'Pick warm emberleaf from the thicket verges.',
  'hollowpine-thicket',
  1,
  2,
  12,
  8,
  1,
  [
    { itemSlug: 'emberleaf', weight: 82, minQuantity: 2, maxQuantity: 4 },
    { itemSlug: 'hollow-root', weight: 18, minQuantity: 1, maxQuantity: 1 },
  ],
);
gather(
  'gather-hollow-root',
  'Pull Hollow Root',
  'Work the whistling roots free of the thicket floor.',
  'hollowpine-thicket',
  3,
  4,
  22,
  16,
  2,
  [
    { itemSlug: 'hollow-root', weight: 74, minQuantity: 1, maxQuantity: 2 },
    { itemSlug: 'crushed-quartz', weight: 26, minQuantity: 1, maxQuantity: 1 },
  ],
);

// --- alchemy recipes -------------------------------------------------------

interface RecipeInput {
  itemSlug: string;
  quantity: number;
}
function recipe(
  slug: string,
  name: string,
  description: string,
  levelRequirement: number,
  goldCost: number,
  durationSeconds: number,
  xpReward: number,
  inputs: RecipeInput[],
  outputItemSlug: string,
  outputQuantity: number,
  sortOrder: number,
): void {
  add('CRAFTING_RECIPE', slug, {
    slug,
    name,
    description,
    profession: 'ALCHEMY',
    locationSlug: 'northmarch-hold',
    levelRequirement,
    goldCost: String(goldCost),
    durationSeconds,
    xpReward,
    inputs,
    outputItemSlug,
    outputQuantity,
    sortOrder,
  });
}

recipe(
  'refine-crushed-quartz',
  'Grind Quartz',
  'Grind hollow-root nodules into potency-fixing grit.',
  1,
  3,
  10,
  6,
  [{ itemSlug: 'hollow-root', quantity: 2 }],
  'crushed-quartz',
  1,
  1,
);
recipe(
  'brew-minor-healing-elixir',
  'Brew Minor Healing Elixir',
  'The first draught every fen-alchemist learns.',
  1,
  5,
  14,
  10,
  [
    { itemSlug: 'frostbell-blossom', quantity: 2 },
    { itemSlug: 'spring-water-vial', quantity: 1 },
  ],
  'minor-healing-elixir',
  1,
  2,
);
recipe(
  'brew-ember-draught',
  'Brew Ember Draught',
  'Steep emberleaf until the draught glows.',
  2,
  8,
  16,
  12,
  [{ itemSlug: 'emberleaf', quantity: 2 }],
  'ember-draught',
  1,
  3,
);
recipe(
  'brew-frost-ward-tonic',
  'Brew Frost-Ward Tonic',
  'A steadying tonic against the northern cold.',
  2,
  9,
  16,
  12,
  [
    { itemSlug: 'frostbell-blossom', quantity: 2 },
    { itemSlug: 'mirebloom', quantity: 1 },
  ],
  'frost-ward-tonic',
  1,
  4,
);
recipe(
  'distill-essence',
  'Distill Essence',
  'Distil mirebloom and spring-water into concentrated essence.',
  2,
  10,
  18,
  14,
  [
    { itemSlug: 'mirebloom', quantity: 2 },
    { itemSlug: 'spring-water-vial', quantity: 1 },
  ],
  'distilled-essence',
  1,
  5,
);
recipe(
  'brew-clarity-philter',
  'Brew Clarity Philter',
  'Fix distilled essence with quartz into a clarity philter.',
  3,
  16,
  22,
  18,
  [
    { itemSlug: 'distilled-essence', quantity: 1 },
    { itemSlug: 'crushed-quartz', quantity: 1 },
  ],
  'clarity-philter',
  1,
  6,
);
recipe(
  'brew-restorative-batch',
  'Brew Restorative Batch',
  'A larger cold-brew yielding a pair of healing elixirs.',
  3,
  18,
  24,
  20,
  [
    { itemSlug: 'frostbell-blossom', quantity: 3 },
    { itemSlug: 'distilled-essence', quantity: 1 },
  ],
  'minor-healing-elixir',
  2,
  7,
);
recipe(
  'brew-greater-healing-elixir',
  'Brew Greater Healing Elixir',
  'Double-distil healing elixirs with hollow-root for a potent restorative.',
  4,
  28,
  30,
  26,
  [
    { itemSlug: 'minor-healing-elixir', quantity: 2 },
    { itemSlug: 'hollow-root', quantity: 1 },
  ],
  'greater-healing-elixir',
  1,
  8,
);

// --- enemies ---------------------------------------------------------------

interface EnemyDrop {
  itemSlug: string;
  chanceBps: number;
  minQuantity: number;
  maxQuantity: number;
}
interface EnemyStats {
  level: number;
  maxHp: number;
  maxMp?: number;
  strength: number;
  agility: number;
  magic: number;
  defense: number;
  magicDefense: number;
  luck: number;
  ranged?: boolean;
}
function enemy(
  slug: string,
  name: string,
  description: string,
  s: EnemyStats,
  affinities: Record<string, number>,
  actions: Array<Record<string, unknown>>,
  reward: { xp: number; goldMin: number; goldMax: number; drops: EnemyDrop[] },
): void {
  add('ENEMY', slug, {
    slug,
    name,
    description,
    level: s.level,
    maxHp: s.maxHp,
    maxMp: s.maxMp ?? 0,
    strength: s.strength,
    agility: s.agility,
    magic: s.magic,
    defense: s.defense,
    magicDefense: s.magicDefense,
    luck: s.luck,
    ranged: s.ranged ?? false,
    // Every element present so combat never reads a missing affinity.
    affinities: { FLAME: 10000, FROST: 10000, STORM: 10000, STONE: 10000, ...affinities },
    aiConfig: { actions },
    rewardConfig: reward,
  });
}

enemy(
  'fen-lurker',
  'Fen Lurker',
  'A mud-slick predator that rises from the shallows without a ripple.',
  {
    level: 3,
    maxHp: 42,
    strength: 13,
    agility: 10,
    magic: 4,
    defense: 8,
    magicDefense: 7,
    luck: 5,
  },
  { FLAME: 13000, FROST: 8000 },
  [
    { kind: 'ATTACK', name: 'Claw', weight: 70 },
    { kind: 'PHYSICAL', name: 'Drag Under', powerBps: 13000, weight: 30 },
  ],
  {
    xp: 20,
    goldMin: 4,
    goldMax: 9,
    drops: [{ itemSlug: 'mirebloom', chanceBps: 2500, minQuantity: 1, maxQuantity: 2 }],
  },
);
enemy(
  'mire-toad',
  'Mire Toad',
  'A bloated toad the size of a shield, with a caustic tongue.',
  { level: 3, maxHp: 46, strength: 11, agility: 7, magic: 6, defense: 9, magicDefense: 9, luck: 4 },
  { STONE: 8000, STORM: 13000 },
  [
    { kind: 'ATTACK', name: 'Tongue-Lash', weight: 65 },
    { kind: 'STATUS', name: 'Caustic Spit', status: 'POISON', magnitude: 3, turns: 3, weight: 35 },
  ],
  {
    xp: 22,
    goldMin: 4,
    goldMax: 8,
    drops: [{ itemSlug: 'frostbell-blossom', chanceBps: 3000, minQuantity: 1, maxQuantity: 2 }],
  },
);
enemy(
  'hollow-stalker',
  'Hollow Stalker',
  'A gaunt, bark-skinned thing that moves between the pines like a rumor.',
  {
    level: 4,
    maxHp: 54,
    strength: 16,
    agility: 14,
    magic: 5,
    defense: 10,
    magicDefense: 8,
    luck: 7,
  },
  { FLAME: 15000, FROST: 9000 },
  [
    { kind: 'ATTACK', name: 'Rake', weight: 60 },
    { kind: 'PHYSICAL', name: 'Ambush', powerBps: 15000, weight: 40 },
  ],
  {
    xp: 30,
    goldMin: 6,
    goldMax: 12,
    drops: [
      { itemSlug: 'hollow-root', chanceBps: 3000, minQuantity: 1, maxQuantity: 2 },
      { itemSlug: 'fen-witch-charm', chanceBps: 500, minQuantity: 1, maxQuantity: 1 },
    ],
  },
);
enemy(
  'frost-wisp',
  'Frost Wisp',
  'A drifting mote of cold light that stings from a distance.',
  {
    level: 4,
    maxHp: 40,
    maxMp: 20,
    strength: 6,
    agility: 16,
    magic: 15,
    defense: 6,
    magicDefense: 14,
    luck: 9,
    ranged: true,
  },
  { FLAME: 16000, FROST: 5000 },
  [
    { kind: 'ATTACK', name: 'Chill Bolt', weight: 60 },
    { kind: 'STATUS', name: 'Numbing Cold', status: 'POISON', magnitude: 2, turns: 2, weight: 40 },
  ],
  {
    xp: 32,
    goldMin: 6,
    goldMax: 12,
    drops: [{ itemSlug: 'emberleaf', chanceBps: 3000, minQuantity: 1, maxQuantity: 2 }],
  },
);
enemy(
  'barrow-wight',
  'Barrow Wight',
  'A grave-cold revenant that guards the Wyrmwatch mounds.',
  {
    level: 5,
    maxHp: 72,
    maxMp: 10,
    strength: 18,
    agility: 9,
    magic: 12,
    defense: 13,
    magicDefense: 13,
    luck: 6,
  },
  { FLAME: 15000, STONE: 8000 },
  [
    { kind: 'ATTACK', name: 'Grave-Chill Strike', weight: 55 },
    { kind: 'PHYSICAL', name: 'Barrow Grasp', powerBps: 16000, weight: 45 },
  ],
  {
    xp: 48,
    goldMin: 10,
    goldMax: 20,
    drops: [{ itemSlug: 'barrow-lantern', chanceBps: 1200, minQuantity: 1, maxQuantity: 1 }],
  },
);
enemy(
  'the-fen-wyrm',
  'The Fen-Wyrm',
  'The old thing the barrows were raised to watch: a pale, coiling wyrm of the deep fen.',
  {
    level: 6,
    maxHp: 160,
    maxMp: 30,
    strength: 22,
    agility: 12,
    magic: 18,
    defense: 16,
    magicDefense: 16,
    luck: 8,
  },
  { FLAME: 16000, FROST: 6000, STORM: 12000 },
  [
    { kind: 'ATTACK', name: 'Rending Bite', weight: 50 },
    { kind: 'PHYSICAL', name: 'Coil Crush', powerBps: 18000, weight: 30 },
    { kind: 'STATUS', name: 'Venom Spray', status: 'POISON', magnitude: 5, turns: 3, weight: 20 },
  ],
  {
    xp: 140,
    goldMin: 40,
    goldMax: 80,
    drops: [
      { itemSlug: 'wyrm-scale-sigil', chanceBps: 6000, minQuantity: 1, maxQuantity: 1 },
      { itemSlug: 'greater-healing-elixir', chanceBps: 4000, minQuantity: 1, maxQuantity: 2 },
    ],
  },
);

// --- encounters ------------------------------------------------------------

function encounter(
  slug: string,
  name: string,
  description: string,
  locationSlug: string,
  kind: string,
  fleeable: boolean,
  composition: Array<{ enemySlug: string; row: string }>,
  fleeModifierBps: number,
  sortOrder: number,
  unlockRequirements: Record<string, unknown> | null = null,
): void {
  add('ENCOUNTER', slug, {
    slug,
    name,
    description,
    locationSlug,
    kind,
    fleeable,
    composition,
    fleeModifierBps,
    unlockRequirements,
    sortOrder,
  });
}

encounter(
  'fen-ambush',
  'Fen Ambush',
  'The shallows erupt — a lurker and a toad have your scent.',
  'frostmere-fen',
  'NORMAL',
  true,
  [
    { enemySlug: 'fen-lurker', row: 'FRONT' },
    { enemySlug: 'mire-toad', row: 'FRONT' },
  ],
  500,
  1,
);
encounter(
  'thicket-hunt',
  'Thicket Hunt',
  'A stalker breaks cover as a wisp drifts in from the canopy.',
  'hollowpine-thicket',
  'NORMAL',
  true,
  [
    { enemySlug: 'hollow-stalker', row: 'FRONT' },
    { enemySlug: 'frost-wisp', row: 'BACK' },
  ],
  0,
  1,
);
encounter(
  'frozen-sentinels',
  'Frozen Sentinels',
  'Two wisps and a lurker close in a ring of biting cold.',
  'frostmere-fen',
  'ELITE',
  true,
  [
    { enemySlug: 'frost-wisp', row: 'BACK' },
    { enemySlug: 'frost-wisp', row: 'BACK' },
    { enemySlug: 'fen-lurker', row: 'FRONT' },
  ],
  -500,
  2,
);
encounter(
  'barrow-vigil',
  'Barrow Vigil',
  'Two barrow-wights rise from the mounds to turn you back.',
  'wyrmwatch-barrow',
  'ELITE',
  true,
  [
    { enemySlug: 'barrow-wight', row: 'FRONT' },
    { enemySlug: 'barrow-wight', row: 'FRONT' },
  ],
  -1000,
  2,
);
encounter(
  'the-fen-wyrm',
  'The Fen-Wyrm',
  'The barrows fall silent. Something vast uncoils from the deep fen.',
  'wyrmwatch-barrow',
  'BOSS',
  false,
  [{ enemySlug: 'the-fen-wyrm', row: 'FRONT' }],
  0,
  3,
  { minCharacterLevel: 5, requiresVictoryOverEncounterSlug: 'barrow-vigil' },
);

// --- quests ----------------------------------------------------------------

interface Objective {
  type: string;
  targetSlug: string;
  requiredCount: number;
  description: string;
}
function quest(
  slug: string,
  name: string,
  description: string,
  rewardXp: number,
  rewardGold: number,
  rewardItems: RecipeInput[],
  sortOrder: number,
  objectives: Objective[],
): void {
  add('QUEST', slug, {
    slug,
    name,
    description,
    rewardXp,
    rewardGold: String(rewardGold),
    rewardItems,
    sortOrder,
    objectives: objectives.map((o, i) => ({ sortOrder: i + 1, ...o })),
  });
}

quest(
  'northward-bound',
  'Northward Bound',
  'Report to the Warden’s Hold at the head of the North Road.',
  30,
  20,
  [],
  1,
  [
    {
      type: 'TRAVEL_TO_LOCATION',
      targetSlug: 'northmarch-hold',
      requiredCount: 1,
      description: 'Travel to Northmarch Hold.',
    },
  ],
);
quest(
  'into-the-fen',
  'Into the Fen',
  'The Warden wants eyes on Frostmere Fen. Walk its cold margins.',
  35,
  20,
  [],
  2,
  [
    {
      type: 'TRAVEL_TO_LOCATION',
      targetSlug: 'frostmere-fen',
      requiredCount: 1,
      description: 'Travel to Frostmere Fen.',
    },
  ],
);
quest(
  'herbalists-first-cutting',
  'A Herbalist’s First Cutting',
  'The Apothecary needs frostbell. Cut a good armful.',
  45,
  25,
  [{ itemSlug: 'spring-water-vial', quantity: 3 }],
  3,
  [
    {
      type: 'GATHER_ITEM',
      targetSlug: 'frostbell-blossom',
      requiredCount: 6,
      description: 'Cut 6 Frostbell Blossom.',
    },
  ],
);
quest(
  'mire-harvest',
  'Mire Harvest',
  'Wade the fen for mirebloom — the clarity-brewers pay well.',
  50,
  30,
  [],
  4,
  [
    {
      type: 'GATHER_ITEM',
      targetSlug: 'mirebloom',
      requiredCount: 5,
      description: 'Gather 5 Mirebloom.',
    },
  ],
);
quest(
  'first-brew',
  'First Brew',
  'Prove your hand at the cold-tables: brew a pair of healing elixirs.',
  55,
  30,
  [],
  5,
  [
    {
      type: 'CRAFT_RECIPE',
      targetSlug: 'brew-minor-healing-elixir',
      requiredCount: 2,
      description: 'Brew Minor Healing Elixir twice.',
    },
  ],
);
quest(
  'the-alchemists-trial',
  'The Alchemist’s Trial',
  'Distil essence and fix a clarity philter to earn the Apothecary’s trust.',
  70,
  45,
  [{ itemSlug: 'clarity-philter', quantity: 1 }],
  6,
  [
    {
      type: 'CRAFT_RECIPE',
      targetSlug: 'brew-clarity-philter',
      requiredCount: 1,
      description: 'Brew a Clarity Philter.',
    },
  ],
);
quest(
  'thin-the-fen',
  'Thin the Fen',
  'The lurkers are bold this season. Cull them.',
  60,
  35,
  [],
  7,
  [
    {
      type: 'DEFEAT_ENEMY',
      targetSlug: 'fen-lurker',
      requiredCount: 4,
      description: 'Defeat 4 Fen Lurkers.',
    },
  ],
);
quest(
  'barrow-watch',
  'Barrow Watch',
  'The wights are stirring on the Wyrmwatch mounds. Put two down.',
  80,
  50,
  [{ itemSlug: 'sealed-warden-orders', quantity: 1 }],
  8,
  [
    {
      type: 'DEFEAT_ENEMY',
      targetSlug: 'barrow-wight',
      requiredCount: 2,
      description: 'Defeat 2 Barrow Wights.',
    },
  ],
);
quest(
  'relics-of-the-barrow',
  'Relics of the Barrow',
  'The Hall of Northern Relics wants a wyrm-scale sigil for its case.',
  90,
  60,
  [],
  9,
  [
    {
      type: 'DONATE_ITEM',
      targetSlug: 'wyrm-scale-sigil',
      requiredCount: 1,
      description: 'Donate a Wyrm-Scale Sigil to the Hall of Northern Relics.',
    },
  ],
);
quest(
  'the-fen-wyrm-slain',
  'The Fen-Wyrm Slain',
  'End the thing the barrows were built to watch.',
  200,
  120,
  [{ itemSlug: 'greater-healing-elixir', quantity: 3 }],
  10,
  [
    {
      type: 'DEFEAT_ENEMY',
      targetSlug: 'the-fen-wyrm',
      requiredCount: 1,
      description: 'Slay the Fen-Wyrm.',
    },
  ],
);

// --- collection ------------------------------------------------------------

add('COLLECTION', 'northmarch-relics', {
  slug: 'northmarch-relics',
  name: 'Relics of the North',
  description: 'The Hall of Northern Relics: barrow-finds and fen-witch curios of the Northmarch.',
  locationSlug: 'northmarch-hold',
  sortOrder: 1,
  entries: [
    {
      itemSlug: 'wyrm-scale-sigil',
      curatorNote: 'Cut from the fen-wyrm itself. The Hall’s proudest acquisition.',
      sortOrder: 1,
    },
    {
      itemSlug: 'barrow-lantern',
      curatorNote: 'Still faintly warm, though its keeper has been dust for an age.',
      sortOrder: 2,
    },
    {
      itemSlug: 'fen-witch-charm',
      curatorNote: 'Reed and bone, knotted against things the fen-witches would not name.',
      sortOrder: 3,
    },
  ],
});

// --- NPC shops -------------------------------------------------------------

interface PoolEntry {
  itemSlug: string;
  weight: number;
  minQuantity: number;
  maxQuantity: number;
  perCharacterLimit: number;
}
function shop(
  slug: string,
  name: string,
  description: string,
  markupBps: number,
  sellbackBps: number,
  restockSlots: number,
  pool: PoolEntry[],
): void {
  add('NPC_SHOP', slug, {
    slug,
    name,
    description,
    locationSlug: 'northmarch-hold',
    markupBps,
    sellbackBps,
    poolConfig: { restockSlots, pool },
    restockIntervalSeconds: 1800,
    restockJitterSeconds: 600,
  });
}

shop(
  'northmarch-provisioner',
  'Northmarch Provisioner',
  'Staples and travelers’ supplies for the road north.',
  12000,
  5000,
  4,
  [
    {
      itemSlug: 'minor-healing-elixir',
      weight: 30,
      minQuantity: 3,
      maxQuantity: 6,
      perCharacterLimit: 3,
    },
    {
      itemSlug: 'frostbell-blossom',
      weight: 25,
      minQuantity: 6,
      maxQuantity: 12,
      perCharacterLimit: 5,
    },
    { itemSlug: 'emberleaf', weight: 25, minQuantity: 6, maxQuantity: 12, perCharacterLimit: 5 },
    {
      itemSlug: 'spring-water-vial',
      weight: 20,
      minQuantity: 5,
      maxQuantity: 10,
      perCharacterLimit: 5,
    },
  ],
);
shop(
  'northmarch-apothecary',
  'Northmarch Apothecary',
  'Reagents and finished draughts, sold by weight.',
  13000,
  6000,
  4,
  [
    { itemSlug: 'ember-draught', weight: 25, minQuantity: 2, maxQuantity: 5, perCharacterLimit: 2 },
    {
      itemSlug: 'frost-ward-tonic',
      weight: 25,
      minQuantity: 2,
      maxQuantity: 5,
      perCharacterLimit: 2,
    },
    {
      itemSlug: 'clarity-philter',
      weight: 20,
      minQuantity: 1,
      maxQuantity: 3,
      perCharacterLimit: 2,
    },
    {
      itemSlug: 'crushed-quartz',
      weight: 30,
      minQuantity: 3,
      maxQuantity: 6,
      perCharacterLimit: 4,
    },
  ],
);

/** Every Northmarch definition, ready to append to a full content bundle. */
export const NORTHMARCH_DEFINITIONS: ContentDefinitionEntry[] = defs;

/** The title used for the published Northmarch content release. */
export const NORTHMARCH_RELEASE_TITLE = 'Expansion — Northmarch, Herbalism, and Alchemy';
