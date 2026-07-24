import { z } from 'zod';

import { goldStringSchema } from './currency.js';
import { itemBonusesSchema, itemRaritySchema, rolledAffixSchema } from './items.js';

/**
 * The Reforge Anvil (Improvement Phase 4). Spend Gold to reroll the rolled
 * affixes on an equipment instance at its current rarity — a Gold sink and an
 * endgame chase for the loot system.
 */

/** A read-only quote: what a reforge would cost and whether it is allowed. */
export const reforgeQuoteSchema = z.object({
  itemInstanceId: z.uuid(),
  itemName: z.string(),
  rarity: itemRaritySchema,
  affixes: z.array(rolledAffixSchema),
  /** Gold cost (decimal string). */
  cost: goldStringSchema,
  /** The character's current Gold balance (decimal string). */
  balance: goldStringSchema,
  canReforge: z.boolean(),
  /** Populated when canReforge is false. */
  reason: z.string().nullable(),
});
export type ReforgeQuote = z.infer<typeof reforgeQuoteSchema>;

export const reforgeRequestSchema = z.object({
  itemInstanceId: z.uuid(),
  /** Idempotency key: a replay never charges or rerolls twice. */
  idempotencyKey: z.string().min(8).max(64),
});
export type ReforgeRequest = z.infer<typeof reforgeRequestSchema>;

export const reforgeResultSchema = z.object({
  itemInstanceId: z.uuid(),
  rarity: itemRaritySchema,
  /** The freshly rolled affixes. */
  affixes: z.array(rolledAffixSchema),
  /** Definition base bonuses plus the new affixes. */
  effectiveBonuses: itemBonusesSchema,
  /** Gold spent on this reforge (0 on an idempotent replay). */
  cost: goldStringSchema,
  /** The character's Gold balance after the reforge. */
  balance: goldStringSchema,
});
export type ReforgeResult = z.infer<typeof reforgeResultSchema>;
