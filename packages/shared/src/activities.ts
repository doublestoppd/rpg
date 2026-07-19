import { z } from 'zod';

import { idempotencyKeySchema } from './travel.js';

/**
 * Repeatable activities (Phase 24): the rotating bounty board, equipment
 * salvage, and NPC sellback. Every repeatable reward is once per character and
 * cycle; salvage and sellback are net Gold/item sinks.
 */

const goldString = z.string().regex(/^\d+$/);

export const bountyCadenceSchema = z.enum(['DAILY', 'WEEKLY']);

export const bountyInfoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  cadence: bountyCadenceSchema,
  region: z.string(),
  cycleId: z.string(),
  requirement: z.object({
    itemSlug: z.string(),
    itemName: z.string(),
    quantity: z.number().int().min(1),
    /** How many the character currently holds (for the UI). */
    held: z.number().int().min(0),
  }),
  rewardGold: goldString,
  rewardReputation: z.number().int().min(0),
  /** Already claimed this cycle (cannot be claimed again). */
  claimed: z.boolean(),
});
export type BountyInfo = z.infer<typeof bountyInfoSchema>;

export const reputationInfoSchema = z.object({
  region: z.string(),
  points: z.number().int().min(0),
  cap: z.number().int().min(1),
});
export type ReputationInfo = z.infer<typeof reputationInfoSchema>;

export const bountyBoardResponseSchema = z.object({
  bounties: z.array(bountyInfoSchema),
  reputation: z.array(reputationInfoSchema),
});
export type BountyBoardResponse = z.infer<typeof bountyBoardResponseSchema>;

export const claimBountyRequestSchema = z.object({ idempotencyKey: idempotencyKeySchema });
export type ClaimBountyRequest = z.infer<typeof claimBountyRequestSchema>;

export const claimBountyResponseSchema = z.object({
  bountySlug: z.string(),
  goldAwarded: goldString,
  balance: goldString,
  region: z.string(),
  reputation: reputationInfoSchema,
});
export type ClaimBountyResponse = z.infer<typeof claimBountyResponseSchema>;

// --- NPC sellback ----------------------------------------------------------

export const sellbackRequestSchema = z.object({
  itemSlug: z.string().min(1),
  quantity: z.number().int().min(1).max(1000),
  idempotencyKey: idempotencyKeySchema,
});
export type SellbackRequest = z.infer<typeof sellbackRequestSchema>;

export const sellbackResponseSchema = z.object({
  itemSlug: z.string(),
  quantity: z.number().int().min(1),
  unitPrice: goldString,
  goldReceived: goldString,
  balance: goldString,
});
export type SellbackResponse = z.infer<typeof sellbackResponseSchema>;

// --- salvage ---------------------------------------------------------------

export const salvageRequestSchema = z.object({
  itemInstanceId: z.uuid(),
  idempotencyKey: idempotencyKeySchema,
});
export type SalvageRequest = z.infer<typeof salvageRequestSchema>;

export const salvageResponseSchema = z.object({
  salvagedItemName: z.string(),
  materials: z.array(
    z.object({ itemSlug: z.string(), name: z.string(), quantity: z.number().int().min(1) }),
  ),
});
export type SalvageResponse = z.infer<typeof salvageResponseSchema>;
