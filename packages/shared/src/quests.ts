import { z } from 'zod';

import { goldStringSchema } from './currency.js';

export const questObjectiveTypeSchema = z.enum([
  'TRAVEL_TO_LOCATION',
  'GATHER_ITEM',
  'CRAFT_RECIPE',
  'DEFEAT_ENEMY',
  'DONATE_ITEM',
]);
export type QuestObjectiveTypeValue = z.infer<typeof questObjectiveTypeSchema>;

/** A character's relationship to a quest (NOT_ACCEPTED = never accepted). */
export const questViewStatusSchema = z.enum([
  'NOT_ACCEPTED',
  'ACCEPTED',
  'ACTIVE',
  'COMPLETED_UNCLAIMED',
  'CLAIMED',
]);
export type QuestViewStatusValue = z.infer<typeof questViewStatusSchema>;

export const questObjectiveViewSchema = z.object({
  description: z.string(),
  type: questObjectiveTypeSchema,
  requiredCount: z.number().int().min(1),
  /** Progress toward requiredCount; 0 until the quest is accepted. */
  currentCount: z.number().int().min(0),
  completed: z.boolean(),
});
export type QuestObjectiveView = z.infer<typeof questObjectiveViewSchema>;

export const questRewardsViewSchema = z.object({
  xp: z.number().int().min(0),
  gold: goldStringSchema,
  items: z.array(z.object({ name: z.string(), quantity: z.number().int().min(1) })),
});
export type QuestRewardsView = z.infer<typeof questRewardsViewSchema>;

export const questViewSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  status: questViewStatusSchema,
  objectives: z.array(questObjectiveViewSchema),
  rewards: questRewardsViewSchema,
  /** True exactly when the quest is COMPLETED_UNCLAIMED. */
  claimable: z.boolean(),
});
export type QuestView = z.infer<typeof questViewSchema>;

export const questsResponseSchema = z.object({
  quests: z.array(questViewSchema),
});
export type QuestsResponse = z.infer<typeof questsResponseSchema>;

export const claimQuestResponseSchema = z.object({
  quest: questViewSchema,
  granted: questRewardsViewSchema,
});
export type ClaimQuestResponse = z.infer<typeof claimQuestResponseSchema>;
