import { z } from 'zod';

import { goldStringSchema } from './currency.js';
import { idempotencyKeySchema } from './travel.js';

export const combatElementSchema = z.enum(['FLAME', 'FROST', 'STORM', 'STONE']);
export type CombatElementValue = z.infer<typeof combatElementSchema>;

export const combatStatusTypeSchema = z.enum([
  'POISON',
  'BLIND',
  'SILENCE',
  'SLOW',
  'HASTE',
  'GUARD',
  'STUN',
  'ARMOR_BREAK',
]);
export type CombatStatusTypeValue = z.infer<typeof combatStatusTypeSchema>;

export const encounterKindSchema = z.enum(['NORMAL', 'ELITE', 'BOSS']);
export type EncounterKindValue = z.infer<typeof encounterKindSchema>;

export const combatStateStatusSchema = z.enum(['ACTIVE', 'VICTORY', 'DEFEAT', 'FLED']);
export type CombatStateStatusValue = z.infer<typeof combatStateStatusSchema>;

export const encounterInfoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  kind: encounterKindSchema,
  fleeable: z.boolean(),
  enemies: z.array(z.object({ name: z.string(), count: z.number().int().min(1) })),
  unlocked: z.boolean(),
  lockedReason: z.string().nullable(),
});
export type EncounterInfo = z.infer<typeof encounterInfoSchema>;

export const encountersResponseSchema = z.object({
  encounters: z.array(encounterInfoSchema),
  /** The character's active combat anywhere, for refresh persistence. */
  activeCombatId: z.uuid().nullable(),
});
export type EncountersResponse = z.infer<typeof encountersResponseSchema>;

export const startCombatRequestSchema = z.object({
  encounterSlug: z.string().min(1),
  idempotencyKey: idempotencyKeySchema,
});
export type StartCombatRequest = z.infer<typeof startCombatRequestSchema>;

export const combatStatusEffectSchema = z.object({
  type: combatStatusTypeSchema,
  magnitude: z.number().int(),
  remainingTurns: z.number().int(),
});
export type CombatStatusEffectInfo = z.infer<typeof combatStatusEffectSchema>;

export const combatantViewSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['PLAYER', 'ENEMY', 'ALLY']),
  name: z.string(),
  row: z.enum(['FRONT', 'BACK']),
  hp: z.number().int().min(0),
  maxHp: z.number().int().min(1),
  mp: z.number().int().min(0),
  maxMp: z.number().int().min(0),
  /** Initiative gauge scaled to 0-100 (100 = ready). */
  gauge: z.number().int().min(0).max(100),
  statuses: z.array(combatStatusEffectSchema),
  defeated: z.boolean(),
});
export type CombatantView = z.infer<typeof combatantViewSchema>;

export const combatAbilityInfoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  /** ABILITY-menu entries are PHYSICAL/SUPPORT; MAGIC-menu entries MAGICAL. */
  kind: z.enum(['PHYSICAL', 'MAGICAL', 'SUPPORT']),
  mpCost: z.number().int().min(0),
  element: combatElementSchema.nullable(),
  targeting: z.enum(['ENEMY', 'ALL_ENEMIES', 'SELF']),
  /** Actor-turn cooldown after use (Phase 23). */
  cooldownTurns: z.number().int().min(0).default(0),
  /** Turns remaining before this ability can be used again (0 = ready). */
  cooldownRemaining: z.number().int().min(0).default(0),
});
export type CombatAbilityInfo = z.infer<typeof combatAbilityInfoSchema>;

export const combatUsableItemSchema = z.object({
  slug: z.string(),
  name: z.string(),
  quantity: z.number().int().min(1),
  hpRestore: z.number().int().min(0),
  mpRestore: z.number().int().min(0),
});
export type CombatUsableItem = z.infer<typeof combatUsableItemSchema>;

export const combatRewardsSchema = z.object({
  xp: z.number().int().min(0),
  gold: goldStringSchema,
  drops: z.array(z.object({ name: z.string(), quantity: z.number().int().min(1) })),
  /** Drops that could not fit in the pack (never duplicated later). */
  leftBehind: z.array(z.object({ name: z.string(), quantity: z.number().int().min(1) })),
  leveledUp: z.boolean(),
  level: z.number().int().min(1),
});
export type CombatRewards = z.infer<typeof combatRewardsSchema>;

export const combatViewSchema = z.object({
  id: z.uuid(),
  status: combatStateStatusSchema,
  version: z.number().int().min(0),
  encounter: z.object({
    slug: z.string(),
    name: z.string(),
    kind: encounterKindSchema,
    fleeable: z.boolean(),
  }),
  player: combatantViewSchema,
  enemies: z.array(combatantViewSchema),
  /** Summoned player-side allies that fight automatically (may be empty). */
  allies: z.array(combatantViewSchema),
  /** True while ACTIVE: the player is always paused at a command phase. */
  awaitingCommand: z.boolean(),
  abilities: z.array(combatAbilityInfoSchema),
  usableItems: z.array(combatUsableItemSchema),
  log: z.array(z.string()),
  /** Present only after VICTORY. */
  rewards: combatRewardsSchema.nullable(),
});
export type CombatView = z.infer<typeof combatViewSchema>;

export const combatCommandRequestSchema = z.object({
  action: z.enum(['ATTACK', 'ABILITY', 'MAGIC', 'ITEM', 'DEFEND', 'FLEE']),
  targetCombatantId: z.uuid().optional(),
  abilitySlug: z.string().optional(),
  itemSlug: z.string().optional(),
  idempotencyKey: idempotencyKeySchema,
  /** Optimistic concurrency: must match the server's current version. */
  expectedVersion: z.number().int().min(0),
});
export type CombatCommandRequest = z.infer<typeof combatCommandRequestSchema>;
