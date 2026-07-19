import { z } from 'zod';

/**
 * Combat constants (Phase 12). All math is fixed-point integer basis points;
 * validated at module load so a bad value fails fast. Damage formulas:
 *
 *   physical offense   = floor(strength * powerBps / 10000) + basePhysical
 *   physical mitigation = floor(defense * defenseMitigationBps / 10000)
 *   magical offense    = floor(magic * spellPowerBps / 10000) + baseMagical
 *   magical mitigation = floor(magicDefense * magicMitigationBps / 10000)
 *   damage             = max(1, offense - mitigation)
 *                        × elemental multiplier bps (0 = immune → 0 damage)
 *                        × secure 90-110% variance bps
 *                        × guard / back-row reductions where applicable
 */
const combatConfigSchema = z.object({
  /** Flat damage added to every physical/magical hit before mitigation. */
  basePhysical: z.number().int().min(0),
  baseMagical: z.number().int().min(0),
  /** Defense contribution to physical mitigation. */
  defenseMitigationBps: z.number().int().min(0).max(20_000),
  magicMitigationBps: z.number().int().min(0).max(20_000),
  /** Secure per-hit variance range (inclusive), drawn from the combat PRNG. */
  varianceMinBps: z.number().int().min(1),
  varianceMaxBps: z.number().int().min(1),
  /** Base physical hit chance; Blind subtracts its magnitude from this. */
  baseAccuracyBps: z.number().int().min(1).max(10_000),
  /** Damage multiplier while the target holds a basic Guard (Defend). */
  guardReductionBps: z.number().int().min(0).max(10_000),
  /** Melee damage multiplier against a back-row target (unless ranged). */
  backRowMeleeBps: z.number().int().min(0).max(10_000),
  /** Slow / Haste initiative-rate multipliers. */
  slowRateBps: z.number().int().min(1).max(10_000),
  hasteRateBps: z.number().int().min(10_000).max(30_000),
  /** Flee: clamp(min..max, base + agiDiff*perPoint + encounter + attempts*retry). */
  fleeBaseBps: z.number().int(),
  fleePerAgilityPointBps: z.number().int(),
  fleeRetryBonusBps: z.number().int(),
  fleeMinBps: z.number().int().min(0),
  fleeMaxBps: z.number().int().max(10_000),
  /** Defeat: HP/MP restored (rounded up) and the capped recovery fee. */
  defeatRestoreBps: z.number().int().min(1).max(10_000),
  defeatFeeBase: z.bigint().min(0n),
  defeatFeePerLevel: z.bigint().min(0n),
  defeatFeeCap: z.bigint().min(0n),
});

export type CombatConfig = z.infer<typeof combatConfigSchema>;

export const combatConfig: CombatConfig = combatConfigSchema.parse({
  basePhysical: 2,
  baseMagical: 2,
  defenseMitigationBps: 5000,
  magicMitigationBps: 5000,
  varianceMinBps: 9000,
  varianceMaxBps: 11_000,
  baseAccuracyBps: 9500,
  guardReductionBps: 5000,
  backRowMeleeBps: 6000,
  slowRateBps: 5000,
  hasteRateBps: 15_000,
  fleeBaseBps: 5000,
  fleePerAgilityPointBps: 200,
  fleeRetryBonusBps: 1000,
  fleeMinBps: 2000,
  fleeMaxBps: 9500,
  defeatRestoreBps: 4000,
  defeatFeeBase: 10n,
  defeatFeePerLevel: 2n,
  defeatFeeCap: 50n,
});

/**
 * Class ability book. ABILITY commands use kind PHYSICAL/SUPPORT; MAGIC
 * commands use kind MAGICAL (and are blocked by Silence). Data-driven and
 * validated here — services never hard-code ability effects.
 */
const abilityDefinitionSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  classSlug: z.enum(['vanguard', 'wayfarer', 'arcanist']),
  kind: z.enum(['PHYSICAL', 'MAGICAL', 'SUPPORT']),
  mpCost: z.number().int().min(0),
  /** Character level at which this ability becomes equippable (Phase 23). */
  unlockLevel: z.number().int().min(1).default(1),
  /** Actor-turn cooldown after use; 0 = usable every turn (Phase 23). */
  cooldownTurns: z.number().int().min(0).default(0),
  /** Damage power in bps of the attacker's offensive stat (0 = no damage). */
  powerBps: z.number().int().min(0),
  /** Number of damage hits (each rolled separately). */
  hits: z.number().int().min(1).default(1),
  element: z.enum(['FLAME', 'FROST', 'STORM', 'STONE']).optional(),
  targeting: z.enum(['ENEMY', 'ALL_ENEMIES', 'SELF']),
  /** Ranged damage ignores the back-row melee penalty. */
  ranged: z.boolean().default(false),
  applies: z
    .object({
      status: z.enum([
        'POISON',
        'BLIND',
        'SILENCE',
        'SLOW',
        'HASTE',
        'GUARD',
        'STUN',
        'ARMOR_BREAK',
      ]),
      magnitude: z.number().int().min(1),
      turns: z.number().int().min(1),
      chanceBps: z.number().int().min(1).max(10_000),
    })
    .optional(),
});

export type AbilityDefinition = z.infer<typeof abilityDefinitionSchema>;

export const CLASS_ABILITIES: AbilityDefinition[] = z.array(abilityDefinitionSchema).parse([
  // --- Vanguard (Ability command) ---
  {
    slug: 'heavy-strike',
    name: 'Heavy Strike',
    description: 'An overhead blow that trades finesse for raw force.',
    classSlug: 'vanguard',
    kind: 'PHYSICAL',
    mpCost: 4,
    powerBps: 16_000,
    targeting: 'ENEMY',
  },
  {
    slug: 'shield-guard',
    name: 'Shield Guard',
    description: 'Plant the shield and brace: a stronger guard until your next command.',
    classSlug: 'vanguard',
    kind: 'SUPPORT',
    mpCost: 3,
    powerBps: 0,
    targeting: 'SELF',
    applies: { status: 'GUARD', magnitude: 3500, turns: 1, chanceBps: 10_000 },
  },
  {
    slug: 'break-armor',
    name: 'Break Armor',
    description: 'A precise strike at straps and plates that leaves the target exposed.',
    classSlug: 'vanguard',
    kind: 'PHYSICAL',
    mpCost: 5,
    powerBps: 11_000,
    targeting: 'ENEMY',
    applies: { status: 'ARMOR_BREAK', magnitude: 3000, turns: 3, chanceBps: 10_000 },
  },
  // --- Wayfarer (Ability command) ---
  {
    slug: 'quick-shot',
    name: 'Quick Shot',
    description: 'A snapped shot that reaches even the back line at full force.',
    classSlug: 'wayfarer',
    kind: 'PHYSICAL',
    mpCost: 3,
    powerBps: 13_000,
    targeting: 'ENEMY',
    ranged: true,
  },
  {
    slug: 'twin-cut',
    name: 'Twin Cut',
    description: 'Two crossing slashes in a single breath.',
    classSlug: 'wayfarer',
    kind: 'PHYSICAL',
    mpCost: 5,
    powerBps: 8000,
    hits: 2,
    targeting: 'ENEMY',
  },
  {
    slug: 'smoke-step',
    name: 'Smoke Step',
    description: 'A burst of choking smoke that leaves the target swinging blind.',
    classSlug: 'wayfarer',
    kind: 'SUPPORT',
    mpCost: 4,
    powerBps: 0,
    targeting: 'ENEMY',
    applies: { status: 'BLIND', magnitude: 3500, turns: 3, chanceBps: 10_000 },
  },
  // --- Arcanist (Magic command) ---
  {
    slug: 'flame-spark',
    name: 'Flame Spark',
    description: 'A snapping mote of fire that ignites on impact.',
    classSlug: 'arcanist',
    kind: 'MAGICAL',
    mpCost: 5,
    powerBps: 15_000,
    element: 'FLAME',
    targeting: 'ENEMY',
  },
  {
    slug: 'frost-shard',
    name: 'Frost Shard',
    description: 'A lance of ice that chills the target to sluggishness.',
    classSlug: 'arcanist',
    kind: 'MAGICAL',
    mpCost: 6,
    powerBps: 13_000,
    element: 'FROST',
    targeting: 'ENEMY',
    applies: { status: 'SLOW', magnitude: 5000, turns: 2, chanceBps: 5000 },
  },
  {
    slug: 'storm-pulse',
    name: 'Storm Pulse',
    description: 'A crackling shockwave that arcs across every enemy.',
    classSlug: 'arcanist',
    kind: 'MAGICAL',
    mpCost: 9,
    powerBps: 10_000,
    element: 'STORM',
    targeting: 'ALL_ENEMIES',
    cooldownTurns: 1,
  },
  // --- Higher-level abilities (Phase 23), staggered so builds diverge ---
  {
    slug: 'rallying-shout',
    name: 'Rallying Shout',
    description: 'A battle-cry that quickens your own step.',
    classSlug: 'vanguard',
    kind: 'SUPPORT',
    mpCost: 4,
    unlockLevel: 8,
    powerBps: 0,
    targeting: 'SELF',
    applies: { status: 'HASTE', magnitude: 15_000, turns: 3, chanceBps: 10_000 },
  },
  {
    slug: 'earthshaker',
    name: 'Earthshaker',
    description: 'Bring your weapon down like a falling hill, cracking the whole line.',
    classSlug: 'vanguard',
    kind: 'PHYSICAL',
    mpCost: 8,
    unlockLevel: 16,
    cooldownTurns: 2,
    powerBps: 9000,
    element: 'STONE',
    targeting: 'ALL_ENEMIES',
  },
  {
    slug: 'unbreakable',
    name: 'Unbreakable',
    description: 'Set your stance beyond breaking for a moment that matters.',
    classSlug: 'vanguard',
    kind: 'SUPPORT',
    mpCost: 6,
    unlockLevel: 24,
    cooldownTurns: 3,
    powerBps: 0,
    targeting: 'SELF',
    applies: { status: 'GUARD', magnitude: 6000, turns: 2, chanceBps: 10_000 },
  },
  {
    slug: 'pinning-shot',
    name: 'Pinning Shot',
    description: 'A shot to the leg that slows even the swiftest quarry.',
    classSlug: 'wayfarer',
    kind: 'PHYSICAL',
    mpCost: 5,
    unlockLevel: 8,
    powerBps: 9000,
    targeting: 'ENEMY',
    ranged: true,
    applies: { status: 'SLOW', magnitude: 5000, turns: 3, chanceBps: 8000 },
  },
  {
    slug: 'venom-blades',
    name: 'Venom Blades',
    description: 'Coated edges that leave a lingering, spreading poison.',
    classSlug: 'wayfarer',
    kind: 'PHYSICAL',
    mpCost: 6,
    unlockLevel: 16,
    cooldownTurns: 2,
    powerBps: 7000,
    hits: 2,
    targeting: 'ENEMY',
    applies: { status: 'POISON', magnitude: 6, turns: 3, chanceBps: 10_000 },
  },
  {
    slug: 'fan-of-knives',
    name: 'Fan of Knives',
    description: 'A spinning throw that catches the whole front line.',
    classSlug: 'wayfarer',
    kind: 'PHYSICAL',
    mpCost: 8,
    unlockLevel: 24,
    cooldownTurns: 3,
    powerBps: 8000,
    targeting: 'ALL_ENEMIES',
    ranged: true,
  },
  {
    slug: 'stone-spikes',
    name: 'Stone Spikes',
    description: 'Jagged rock erupts beneath a single foe.',
    classSlug: 'arcanist',
    kind: 'MAGICAL',
    mpCost: 6,
    unlockLevel: 8,
    powerBps: 14_000,
    element: 'STONE',
    targeting: 'ENEMY',
  },
  {
    slug: 'silencing-hex',
    name: 'Silencing Hex',
    description: 'A hex that seals a foe’s tongue and stills their spells.',
    classSlug: 'arcanist',
    kind: 'MAGICAL',
    mpCost: 7,
    unlockLevel: 16,
    cooldownTurns: 2,
    powerBps: 6000,
    element: 'STORM',
    targeting: 'ENEMY',
    applies: { status: 'SILENCE', magnitude: 1, turns: 2, chanceBps: 9000 },
  },
  {
    slug: 'meteor',
    name: 'Meteor',
    description: 'Call down a burning stone to break the entire enemy line.',
    classSlug: 'arcanist',
    kind: 'MAGICAL',
    mpCost: 14,
    unlockLevel: 24,
    cooldownTurns: 3,
    powerBps: 13_000,
    element: 'FLAME',
    targeting: 'ALL_ENEMIES',
  },
]);

export function abilitiesForClass(classSlug: string): AbilityDefinition[] {
  return CLASS_ABILITIES.filter((a) => a.classSlug === classSlug);
}

export function findAbility(classSlug: string, slug: string): AbilityDefinition | undefined {
  return CLASS_ABILITIES.find((a) => a.classSlug === classSlug && a.slug === slug);
}

/** The most abilities a character may equip at once (Phase 23). */
export const LOADOUT_CAPACITY = 4;

/**
 * Class talents (Phase 23): a bounded choice at each tier. A character picks at
 * most one talent per unlocked tier; each is a small, deterministic stat
 * modifier applied at combat start. Two options per tier keep at least two
 * viable builds per class without unbounded affix complexity.
 */
const statModifierSchema = z.object({
  maxHpBps: z.number().int().default(0),
  maxMpBps: z.number().int().default(0),
  strengthBps: z.number().int().default(0),
  agilityBps: z.number().int().default(0),
  magicBps: z.number().int().default(0),
  defenseBps: z.number().int().default(0),
  magicDefenseBps: z.number().int().default(0),
  luckBps: z.number().int().default(0),
});
export type StatModifier = z.infer<typeof statModifierSchema>;

const talentDefinitionSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  classSlug: z.enum(['vanguard', 'wayfarer', 'arcanist']),
  tier: z.number().int().min(1).max(3),
  unlockLevel: z.number().int().min(1),
  modifiers: statModifierSchema,
});
export type TalentDefinition = z.infer<typeof talentDefinitionSchema>;

/** Tier → character level at which that talent tier unlocks. */
export const TALENT_TIER_LEVELS: Record<number, number> = { 1: 10, 2: 20, 3: 30 };

export const CLASS_TALENTS: TalentDefinition[] = z.array(talentDefinitionSchema).parse([
  // Vanguard
  {
    slug: 'bulwark',
    name: 'Bulwark',
    description: 'Fortify body and shield.',
    classSlug: 'vanguard',
    tier: 1,
    unlockLevel: 10,
    modifiers: { maxHpBps: 1000, defenseBps: 800 },
  },
  {
    slug: 'berserker',
    name: 'Berserker',
    description: 'Trade caution for raw power.',
    classSlug: 'vanguard',
    tier: 1,
    unlockLevel: 10,
    modifiers: { strengthBps: 1000 },
  },
  {
    slug: 'ironhide',
    name: 'Ironhide',
    description: 'Harden against sorcery.',
    classSlug: 'vanguard',
    tier: 2,
    unlockLevel: 20,
    modifiers: { magicDefenseBps: 1000, maxHpBps: 600 },
  },
  {
    slug: 'juggernaut',
    name: 'Juggernaut',
    description: 'Momentum that flattens guards.',
    classSlug: 'vanguard',
    tier: 2,
    unlockLevel: 20,
    modifiers: { strengthBps: 800, defenseBps: 600 },
  },
  {
    slug: 'colossus',
    name: 'Colossus',
    description: 'An immovable wall of a warrior.',
    classSlug: 'vanguard',
    tier: 3,
    unlockLevel: 30,
    modifiers: { maxHpBps: 1200 },
  },
  {
    slug: 'warlord',
    name: 'Warlord',
    description: 'Every blow lands like a verdict.',
    classSlug: 'vanguard',
    tier: 3,
    unlockLevel: 30,
    modifiers: { strengthBps: 1200 },
  },
  // Wayfarer
  {
    slug: 'fleet',
    name: 'Fleet',
    description: 'Move before they can answer.',
    classSlug: 'wayfarer',
    tier: 1,
    unlockLevel: 10,
    modifiers: { agilityBps: 1000 },
  },
  {
    slug: 'deadeye',
    name: 'Deadeye',
    description: 'Patience rewarded with precision.',
    classSlug: 'wayfarer',
    tier: 1,
    unlockLevel: 10,
    modifiers: { strengthBps: 800, luckBps: 600 },
  },
  {
    slug: 'shadowstep',
    name: 'Shadowstep',
    description: 'Slip the odds in your favor.',
    classSlug: 'wayfarer',
    tier: 2,
    unlockLevel: 20,
    modifiers: { agilityBps: 1000, luckBps: 500 },
  },
  {
    slug: 'predator',
    name: 'Predator',
    description: 'Strike for the throat.',
    classSlug: 'wayfarer',
    tier: 2,
    unlockLevel: 20,
    modifiers: { strengthBps: 1000 },
  },
  {
    slug: 'windrunner',
    name: 'Windrunner',
    description: 'Faster than the eye.',
    classSlug: 'wayfarer',
    tier: 3,
    unlockLevel: 30,
    modifiers: { agilityBps: 1200 },
  },
  {
    slug: 'assassin',
    name: 'Assassin',
    description: 'One chance is all you need.',
    classSlug: 'wayfarer',
    tier: 3,
    unlockLevel: 30,
    modifiers: { strengthBps: 800, luckBps: 800 },
  },
  // Arcanist
  {
    slug: 'scholar',
    name: 'Scholar',
    description: 'Deeper study, sharper spells.',
    classSlug: 'arcanist',
    tier: 1,
    unlockLevel: 10,
    modifiers: { magicBps: 1000 },
  },
  {
    slug: 'warding',
    name: 'Warding',
    description: 'Wards woven into every robe-thread.',
    classSlug: 'arcanist',
    tier: 1,
    unlockLevel: 10,
    modifiers: { magicDefenseBps: 1000, maxMpBps: 600 },
  },
  {
    slug: 'archmage',
    name: 'Archmage',
    description: 'Power and reserves in equal measure.',
    classSlug: 'arcanist',
    tier: 2,
    unlockLevel: 20,
    modifiers: { magicBps: 1000, maxMpBps: 600 },
  },
  {
    slug: 'mystic-guard',
    name: 'Mystic Guard',
    description: 'Turn hostile magic aside.',
    classSlug: 'arcanist',
    tier: 2,
    unlockLevel: 20,
    modifiers: { magicDefenseBps: 1000 },
  },
  {
    slug: 'sorcerer',
    name: 'Sorcerer',
    description: 'Raw arcane overwhelming force.',
    classSlug: 'arcanist',
    tier: 3,
    unlockLevel: 30,
    modifiers: { magicBps: 1200 },
  },
  {
    slug: 'eternal',
    name: 'Eternal',
    description: 'A bottomless well of power.',
    classSlug: 'arcanist',
    tier: 3,
    unlockLevel: 30,
    modifiers: { maxMpBps: 1000, magicDefenseBps: 800 },
  },
]);

export function talentsForClass(classSlug: string): TalentDefinition[] {
  return CLASS_TALENTS.filter((t) => t.classSlug === classSlug);
}

export function findTalent(classSlug: string, slug: string): TalentDefinition | undefined {
  return CLASS_TALENTS.find((t) => t.classSlug === classSlug && t.slug === slug);
}

/** The default equipped loadout for a class at a level: the first unlocked abilities. */
export function defaultLoadout(classSlug: string, level: number): string[] {
  return abilitiesForClass(classSlug)
    .filter((a) => a.unlockLevel <= level)
    .slice(0, LOADOUT_CAPACITY)
    .map((a) => a.slug);
}

/** Applies chosen talent stat modifiers to a derived stat block (Phase 23). */
export function applyTalentModifiers<
  T extends {
    maxHp: number;
    maxMp: number;
    strength: number;
    agility: number;
    magic: number;
    defense: number;
    magicDefense: number;
    luck: number;
  },
>(stats: T, classSlug: string, talentSlugs: string[]): T {
  const total: StatModifier = statModifierSchema.parse({});
  for (const slug of talentSlugs) {
    const talent = findTalent(classSlug, slug);
    if (!talent) continue;
    for (const key of Object.keys(total) as Array<keyof StatModifier>) {
      total[key] += talent.modifiers[key];
    }
  }
  const scale = (value: number, bps: number) => Math.floor((value * (10_000 + bps)) / 10_000);
  return {
    ...stats,
    maxHp: scale(stats.maxHp, total.maxHpBps),
    maxMp: scale(stats.maxMp, total.maxMpBps),
    strength: scale(stats.strength, total.strengthBps),
    agility: scale(stats.agility, total.agilityBps),
    magic: scale(stats.magic, total.magicBps),
    defense: scale(stats.defense, total.defenseBps),
    magicDefense: scale(stats.magicDefense, total.magicDefenseBps),
    luck: scale(stats.luck, total.luckBps),
  };
}
