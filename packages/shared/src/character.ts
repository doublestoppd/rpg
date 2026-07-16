import { z } from 'zod';

export const characterClassSlugSchema = z.enum(['vanguard', 'wayfarer', 'arcanist']);
export type CharacterClassSlug = z.infer<typeof characterClassSlugSchema>;

export const characterNameSchema = z
  .string()
  .trim()
  .min(3, 'Character name must be at least 3 characters')
  .max(24, 'Character name must be at most 24 characters')
  .regex(
    /^[\p{L}][\p{L}\p{N} '-]*$/u,
    'Character name must start with a letter and may contain letters, numbers, spaces, apostrophes, and hyphens',
  );

export const createCharacterRequestSchema = z.object({
  name: characterNameSchema,
  classSlug: characterClassSlugSchema,
});
export type CreateCharacterRequest = z.infer<typeof createCharacterRequestSchema>;

export const characterClassInfoSchema = z.object({
  slug: characterClassSlugSchema,
  name: z.string(),
  description: z.string(),
});
export type CharacterClassInfo = z.infer<typeof characterClassInfoSchema>;

export const characterResourcesSchema = z.object({
  hp: z.number().int().min(0),
  maxHp: z.number().int().min(1),
  mp: z.number().int().min(0),
  maxMp: z.number().int().min(0),
  stamina: z.number().int().min(0),
  maxStamina: z.number().int().min(1),
});
export type CharacterResources = z.infer<typeof characterResourcesSchema>;

export const characterAttributesSchema = z.object({
  strength: z.number().int().min(0),
  agility: z.number().int().min(0),
  magic: z.number().int().min(0),
  defense: z.number().int().min(0),
  magicDefense: z.number().int().min(0),
  luck: z.number().int().min(0),
});
export type CharacterAttributes = z.infer<typeof characterAttributesSchema>;

export const characterResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  class: characterClassInfoSchema,
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
  /** Cumulative XP required for the next level; null at the level cap. */
  xpForNextLevel: z.number().int().nullable(),
  /** Gold as a decimal string (BIGINT server-side). */
  gold: z.string().regex(/^\d+$/),
  resources: characterResourcesSchema,
  createdAt: z.iso.datetime(),
});
export type CharacterResponse = z.infer<typeof characterResponseSchema>;

export const characterStatsResponseSchema = z.object({
  level: z.number().int().min(1),
  attributes: characterAttributesSchema,
  resources: characterResourcesSchema,
});
export type CharacterStatsResponse = z.infer<typeof characterStatsResponseSchema>;

export const characterClassListSchema = z.array(characterClassInfoSchema);
