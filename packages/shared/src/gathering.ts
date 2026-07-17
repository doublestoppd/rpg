import { z } from 'zod';

import { itemDefinitionSchema } from './items.js';
import { idempotencyKeySchema } from './travel.js';

/**
 * Cumulative skill XP required to hold each mining level. The final entry is
 * the level cap. Strictly monotonic; shared so the frontend can display
 * progression without inventing its own numbers.
 */
export const MINING_LEVEL_PROGRESSION: ReadonlyArray<{ level: number; cumulativeXp: number }> = [
  { level: 1, cumulativeXp: 0 },
  { level: 2, cumulativeXp: 20 },
  { level: 3, cumulativeXp: 50 },
  { level: 4, cumulativeXp: 90 },
  { level: 5, cumulativeXp: 140 },
  { level: 6, cumulativeXp: 200 },
  { level: 7, cumulativeXp: 270 },
  { level: 8, cumulativeXp: 350 },
  { level: 9, cumulativeXp: 440 },
  { level: 10, cumulativeXp: 540 },
];

/** Highest mining level held at the given cumulative XP. */
export function miningLevelForXp(xp: number): number {
  let level = 1;
  for (const row of MINING_LEVEL_PROGRESSION) {
    if (xp >= row.cumulativeXp) level = row.level;
  }
  return level;
}

/** Cumulative XP needed for the next mining level, or null at the cap. */
export function miningXpForNextLevel(level: number): number | null {
  const next = MINING_LEVEL_PROGRESSION.find((row) => row.level === level + 1);
  return next ? next.cumulativeXp : null;
}

export const skillTypeSchema = z.enum(['MINING']);
export type SkillTypeValue = z.infer<typeof skillTypeSchema>;

export const miningSkillSchema = z.object({
  skill: skillTypeSchema,
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
  /** Cumulative XP for the next level; null at the cap. */
  xpForNextLevel: z.number().int().nullable(),
});
export type MiningSkillInfo = z.infer<typeof miningSkillSchema>;

export const gatheringActionSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  skill: skillTypeSchema,
  levelRequirement: z.number().int().min(1),
  staminaCost: z.number().int().min(1),
  durationSeconds: z.number().int().min(1),
  xpReward: z.number().int().min(1),
  /** Whether this character's skill level meets the requirement. */
  unlocked: z.boolean(),
});
export type GatheringActionInfo = z.infer<typeof gatheringActionSchema>;

export const gatheringActionsResponseSchema = z.object({
  skill: miningSkillSchema,
  /** Actions offered at the character's current location (may be empty). */
  actions: z.array(gatheringActionSchema),
});
export type GatheringActionsResponse = z.infer<typeof gatheringActionsResponseSchema>;

export const startGatheringRequestSchema = z.object({
  actionSlug: z.string().min(1),
  idempotencyKey: idempotencyKeySchema,
});
export type StartGatheringRequest = z.infer<typeof startGatheringRequestSchema>;

export const gatheringRunStatusSchema = z.enum(['IN_PROGRESS', 'REWARD_HELD', 'COMPLETED']);
export type GatheringRunStatusValue = z.infer<typeof gatheringRunStatusSchema>;

/**
 * A pending (or just-started) run. Deliberately reward-free: the rolled
 * outcome is server-private until the run finalizes.
 */
export const gatheringRunSchema = z.object({
  id: z.uuid(),
  actionSlug: z.string(),
  actionName: z.string(),
  status: gatheringRunStatusSchema,
  startedAt: z.iso.datetime(),
  completesAt: z.iso.datetime(),
  remainingSeconds: z.number().int().min(0),
});
export type GatheringRun = z.infer<typeof gatheringRunSchema>;

export const gatheringRewardSchema = z.object({
  item: itemDefinitionSchema,
  quantity: z.number().int().min(1),
});
export type GatheringReward = z.infer<typeof gatheringRewardSchema>;

/** A finished run whose reward is revealed (granted or held for capacity). */
export const gatheringResultSchema = z.object({
  id: z.uuid(),
  actionSlug: z.string(),
  actionName: z.string(),
  status: gatheringRunStatusSchema,
  completedAt: z.iso.datetime(),
  rewards: z.array(gatheringRewardSchema),
  xpAwarded: z.number().int().min(0),
});
export type GatheringResult = z.infer<typeof gatheringResultSchema>;

export const gatheringStatusResponseSchema = z.object({
  skill: miningSkillSchema,
  /** The unexpired in-progress run, if any (no reward information). */
  active: gatheringRunSchema.nullable(),
  /** A finished run whose reward is waiting on free inventory space. */
  held: gatheringResultSchema.nullable(),
  /** The most recently completed run, for result reveal after refresh. */
  lastCompleted: gatheringResultSchema.nullable(),
});
export type GatheringStatusResponse = z.infer<typeof gatheringStatusResponseSchema>;

export const claimGatheringResponseSchema = z.object({
  result: gatheringResultSchema,
  skill: miningSkillSchema,
});
export type ClaimGatheringResponse = z.infer<typeof claimGatheringResponseSchema>;
