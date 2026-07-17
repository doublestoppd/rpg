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
  },
]);

export function abilitiesForClass(classSlug: string): AbilityDefinition[] {
  return CLASS_ABILITIES.filter((a) => a.classSlug === classSlug);
}

export function findAbility(classSlug: string, slug: string): AbilityDefinition | undefined {
  return CLASS_ABILITIES.find((a) => a.classSlug === classSlug && a.slug === slug);
}
