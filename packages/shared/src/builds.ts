import { z } from 'zod';

/**
 * Character builds (Phase 23): a bounded ability loadout and one talent choice
 * per unlocked tier. Combat snapshots the build at start, so changing it never
 * affects a battle already underway.
 */

export const abilityKindSchema = z.enum(['PHYSICAL', 'MAGICAL', 'SUPPORT']);
export const abilityTargetingSchema = z.enum(['ENEMY', 'ALL_ENEMIES', 'SELF']);
export const combatElementSchemaLite = z.enum(['FLAME', 'FROST', 'STORM', 'STONE']);

export const buildAbilitySchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  kind: abilityKindSchema,
  mpCost: z.number().int().min(0),
  element: combatElementSchemaLite.nullable(),
  targeting: abilityTargetingSchema,
  unlockLevel: z.number().int().min(1),
  cooldownTurns: z.number().int().min(0),
  /** The character's level meets the unlock requirement. */
  unlocked: z.boolean(),
  /** Currently in the equipped loadout. */
  equipped: z.boolean(),
});
export type BuildAbilityInfo = z.infer<typeof buildAbilitySchema>;

export const buildTalentOptionSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  /** Human-readable modifier summary, e.g. "+10% Strength". */
  effect: z.string(),
  chosen: z.boolean(),
});
export type BuildTalentOption = z.infer<typeof buildTalentOptionSchema>;

export const buildTalentTierSchema = z.object({
  tier: z.number().int().min(1),
  unlockLevel: z.number().int().min(1),
  unlocked: z.boolean(),
  chosenSlug: z.string().nullable(),
  options: z.array(buildTalentOptionSchema),
});
export type BuildTalentTier = z.infer<typeof buildTalentTierSchema>;

export const characterBuildResponseSchema = z.object({
  classSlug: z.string(),
  level: z.number().int().min(1),
  loadoutCapacity: z.number().int().min(1),
  configVersion: z.number().int().min(0),
  /** Gold cost of a respec at this level, as a decimal string. */
  respecFeeGold: z.string().regex(/^\d+$/),
  abilities: z.array(buildAbilitySchema),
  talents: z.array(buildTalentTierSchema),
});
export type CharacterBuildResponse = z.infer<typeof characterBuildResponseSchema>;

export const setLoadoutRequestSchema = z.object({
  abilitySlugs: z.array(z.string().min(1)).max(12),
});
export type SetLoadoutRequest = z.infer<typeof setLoadoutRequestSchema>;

export const chooseTalentRequestSchema = z.object({
  tier: z.number().int().min(1).max(3),
  /** The talent to select, or null to clear this tier. */
  talentSlug: z.string().min(1).nullable(),
});
export type ChooseTalentRequest = z.infer<typeof chooseTalentRequestSchema>;

export const respecRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
});
export type RespecRequest = z.infer<typeof respecRequestSchema>;
