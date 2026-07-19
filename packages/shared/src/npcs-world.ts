import { z } from 'zod';

import { worldTimeSegmentSchema } from './world-sim.js';

/**
 * Named NPC contracts (Phase 26). NPCs are versioned game content; these are
 * the read models the player UI consumes. Roles are descriptive only and grant
 * no capability — actual services are linked through a typed service
 * association resolved by the existing domain services.
 */

export const npcRoleSchema = z.enum([
  'INNKEEPER',
  'MERCHANT',
  'CRAFTSPERSON',
  'TRAINER',
  'QUEST_GIVER',
  'CURATOR',
  'GUARD',
  'TRAVELER',
  'WORKER',
  'SCHOLAR',
  'AMBIENT',
]);
export type NpcRole = z.infer<typeof npcRoleSchema>;

/** Typed service association (what real service an NPC can open, if any). */
export const npcServiceTypeSchema = z.enum([
  'NONE',
  'SHOP',
  'INN',
  'CRAFTING',
  'MUSEUM',
  'TRAINING',
]);
export type NpcServiceType = z.infer<typeof npcServiceTypeSchema>;

/** Whether the NPC is present at the character's current location + segment. */
export const npcAvailabilitySchema = z.enum(['PRESENT', 'OFF_SCHEDULE', 'ELSEWHERE']);
export type NpcAvailability = z.infer<typeof npcAvailabilitySchema>;

export const npcInfoSchema = z.object({
  key: z.string(),
  name: z.string(),
  pronouns: z.string(),
  roles: z.array(npcRoleSchema),
  shortDescription: z.string(),
  homeRegion: z.string(),
  tags: z.array(z.string()),
  portraitAssetKey: z.string(),
  sceneAssetKey: z.string().nullable(),
  serviceType: npcServiceTypeSchema,
  /** Present-at-this-location-and-segment for the requesting character. */
  availability: npcAvailabilitySchema,
});
export type NpcInfo = z.infer<typeof npcInfoSchema>;

export const npcListResponseSchema = z.object({
  locationSlug: z.string(),
  segment: worldTimeSegmentSchema,
  npcs: z.array(npcInfoSchema),
});
export type NpcListResponse = z.infer<typeof npcListResponseSchema>;

export const npcDetailResponseSchema = npcInfoSchema.extend({
  longDescription: z.string(),
  /** Segments during which this NPC appears at its placements. */
  scheduleSegments: z.array(worldTimeSegmentSchema),
});
export type NpcDetailResponse = z.infer<typeof npcDetailResponseSchema>;
