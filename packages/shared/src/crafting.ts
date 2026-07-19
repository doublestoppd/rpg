import { z } from 'zod';

import { goldStringSchema } from './currency.js';
import { itemDefinitionSchema } from './items.js';
import { idempotencyKeySchema } from './travel.js';

/**
 * Cumulative profession XP required to hold each Blacksmithing level. The
 * final entry is the level cap. Strictly monotonic; shared so the frontend
 * can display progression without inventing its own numbers.
 */
export const BLACKSMITHING_LEVEL_PROGRESSION: ReadonlyArray<{
  level: number;
  cumulativeXp: number;
}> = [
  { level: 1, cumulativeXp: 0 },
  { level: 2, cumulativeXp: 25 },
  { level: 3, cumulativeXp: 60 },
  { level: 4, cumulativeXp: 105 },
  { level: 5, cumulativeXp: 160 },
  { level: 6, cumulativeXp: 225 },
  { level: 7, cumulativeXp: 300 },
  { level: 8, cumulativeXp: 385 },
  { level: 9, cumulativeXp: 480 },
  { level: 10, cumulativeXp: 585 },
];

/** Highest Blacksmithing level held at the given cumulative XP. */
export function blacksmithingLevelForXp(xp: number): number {
  let level = 1;
  for (const row of BLACKSMITHING_LEVEL_PROGRESSION) {
    if (xp >= row.cumulativeXp) level = row.level;
  }
  return level;
}

/** Cumulative XP needed for the next Blacksmithing level, or null at cap. */
export function blacksmithingXpForNextLevel(level: number): number | null {
  const next = BLACKSMITHING_LEVEL_PROGRESSION.find((row) => row.level === level + 1);
  return next ? next.cumulativeXp : null;
}

export const professionTypeSchema = z.enum(['BLACKSMITHING', 'ALCHEMY']);
export type ProfessionTypeValue = z.infer<typeof professionTypeSchema>;

/** Human-readable crafting profession names (for messages and UI labels). */
export const PROFESSION_LABELS: Record<ProfessionTypeValue, string> = {
  BLACKSMITHING: 'Blacksmithing',
  ALCHEMY: 'Alchemy',
};

/**
 * Crafting professions share one XP curve (Phase 22). Aliases read clearly for
 * any profession; the blacksmithing-named helpers remain for compatibility.
 */
export const craftingLevelForXp = blacksmithingLevelForXp;
export const craftingXpForNextLevel = blacksmithingXpForNextLevel;

export const professionProgressSchema = z.object({
  profession: professionTypeSchema,
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
  /** Cumulative XP for the next level; null at the cap. */
  xpForNextLevel: z.number().int().nullable(),
});
export type ProfessionProgressInfo = z.infer<typeof professionProgressSchema>;

export const recipeInputSchema = z.object({
  item: itemDefinitionSchema,
  quantity: z.number().int().min(1),
});
export type RecipeInputInfo = z.infer<typeof recipeInputSchema>;

export const craftingRecipeSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  profession: professionTypeSchema,
  levelRequirement: z.number().int().min(1),
  goldCost: goldStringSchema,
  durationSeconds: z.number().int().min(1),
  xpReward: z.number().int().min(1),
  inputs: z.array(recipeInputSchema),
  outputItem: itemDefinitionSchema,
  outputQuantity: z.number().int().min(1),
  /** Whether this character's profession level meets the requirement. */
  unlocked: z.boolean(),
});
export type CraftingRecipeInfo = z.infer<typeof craftingRecipeSchema>;

export const craftingRecipesResponseSchema = z.object({
  profession: professionProgressSchema,
  /** Recipes offered at the character's current location (may be empty). */
  recipes: z.array(craftingRecipeSchema),
});
export type CraftingRecipesResponse = z.infer<typeof craftingRecipesResponseSchema>;

export const startCraftingRequestSchema = z.object({
  recipeSlug: z.string().min(1),
  idempotencyKey: idempotencyKeySchema,
});
export type StartCraftingRequest = z.infer<typeof startCraftingRequestSchema>;

export const craftingRunStatusSchema = z.enum(['IN_PROGRESS', 'OUTPUT_HELD', 'COMPLETED']);
export type CraftingRunStatusValue = z.infer<typeof craftingRunStatusSchema>;

/** A pending (or just-started) run. */
export const craftingRunSchema = z.object({
  id: z.uuid(),
  recipeSlug: z.string(),
  recipeName: z.string(),
  status: craftingRunStatusSchema,
  startedAt: z.iso.datetime(),
  completesAt: z.iso.datetime(),
  remainingSeconds: z.number().int().min(0),
});
export type CraftingRun = z.infer<typeof craftingRunSchema>;

export const craftingOutputSchema = z.object({
  item: itemDefinitionSchema,
  quantity: z.number().int().min(1),
});
export type CraftingOutput = z.infer<typeof craftingOutputSchema>;

/** A finished run (output granted, or held for capacity). */
export const craftingResultSchema = z.object({
  id: z.uuid(),
  recipeSlug: z.string(),
  recipeName: z.string(),
  status: craftingRunStatusSchema,
  completedAt: z.iso.datetime(),
  output: z.array(craftingOutputSchema),
  xpAwarded: z.number().int().min(0),
});
export type CraftingResult = z.infer<typeof craftingResultSchema>;

export const craftingStatusResponseSchema = z.object({
  profession: professionProgressSchema,
  /** The unexpired in-progress run, if any. */
  active: craftingRunSchema.nullable(),
  /** A finished run whose output is waiting on free inventory space. */
  held: craftingResultSchema.nullable(),
  /** The most recently completed run, for result display after refresh. */
  lastCompleted: craftingResultSchema.nullable(),
});
export type CraftingStatusResponse = z.infer<typeof craftingStatusResponseSchema>;

export const claimCraftingResponseSchema = z.object({
  result: craftingResultSchema,
  profession: professionProgressSchema,
});
export type ClaimCraftingResponse = z.infer<typeof claimCraftingResponseSchema>;
