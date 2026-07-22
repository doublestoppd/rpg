import { z } from 'zod';

import { locationFeatureSchema, locationSchema } from './location.js';
import { npcInfoSchema } from './npcs-world.js';
import { atmosphereResponseSchema, worldTimeSegmentSchema } from './world-sim.js';

/**
 * World events, the local activity feed, and the coherent current-scene read
 * model (Phase 26, increment 4). Events are timestamp-authoritative occurrences
 * of versioned definitions; activity is a privacy-safe projection over verified
 * domain records — typed template parameters, never raw HTML, never account
 * identifiers or player names.
 */

export const worldEventTypeSchema = z.enum([
  'MARKET_DAY',
  'FESTIVAL',
  'STORM',
  'CARAVAN_ARRIVAL',
  'MINE_SHIFT_CHANGE',
  'HARBOR_ARRIVAL',
  'MONSTER_ACTIVITY',
  'MUSEUM_EXHIBIT',
  'NPC_VISIT',
  'REGIONAL_RUMOR',
]);
export type WorldEventType = z.infer<typeof worldEventTypeSchema>;

export const worldEventInfoSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  eventType: worldEventTypeSchema,
  region: z.string(),
  locationSlug: z.string().nullable(),
  priority: z.number().int(),
  sceneDescriptionKey: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
});
export type WorldEventInfo = z.infer<typeof worldEventInfoSchema>;

export const worldEventsResponseSchema = z.object({
  region: z.string(),
  events: z.array(worldEventInfoSchema),
});
export type WorldEventsResponse = z.infer<typeof worldEventsResponseSchema>;

/** Versioned world-event definition payload (content type WORLD_EVENT). */
export const worldEventDefinitionPayloadSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  eventType: worldEventTypeSchema,
  region: z.string().min(1),
  locationSlug: z.string().min(1).nullable(),
  everyCycles: z.number().int().min(1),
  offsetCycles: z.number().int().min(0),
  durationCycles: z.number().int().min(1),
  priority: z.number().int(),
  sceneDescriptionKey: z.string().min(1).nullable(),
});
export type WorldEventDefinitionPayload = z.infer<typeof worldEventDefinitionPayloadSchema>;

// --- local activity ---------------------------------------------------------

/** Typed, anonymous activity entries. Rendering is client-side from params. */
export const activityEntrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('WORLD_EVENT_STARTED'), name: z.string(), at: z.string() }),
  z.object({
    type: z.literal('MARKETPLACE_SALE'),
    itemName: z.string(),
    quantity: z.number().int().min(1),
    at: z.string(),
  }),
  z.object({
    type: z.literal('MUSEUM_DONATION'),
    itemName: z.string(),
    collectionName: z.string(),
    at: z.string(),
  }),
  z.object({ type: z.literal('SHOP_RESTOCKED'), shopName: z.string(), at: z.string() }),
]);
export type ActivityEntry = z.infer<typeof activityEntrySchema>;

export const activityResponseSchema = z.object({
  locationSlug: z.string(),
  entries: z.array(activityEntrySchema),
});
export type ActivityResponse = z.infer<typeof activityResponseSchema>;

// --- present players ---------------------------------------------------------

/**
 * A player character currently present at the location. Only public character
 * identity is exposed — the same name, class, and level shown in chat and
 * combat — never the account behind it.
 */
export const presentPlayerSchema = z.object({
  name: z.string(),
  classSlug: z.string(),
  level: z.number().int().min(1),
});
export type PresentPlayer = z.infer<typeof presentPlayerSchema>;

// --- the coherent scene read model ------------------------------------------

export const sceneResponseSchema = z.object({
  location: locationSchema,
  segment: worldTimeSegmentSchema,
  cycleId: z.string(),
  atmosphere: atmosphereResponseSchema,
  events: z.array(worldEventInfoSchema),
  npcs: z.array(npcInfoSchema),
  /** Other players active at this location recently (excludes the caller). */
  players: z.array(presentPlayerSchema),
  features: z.array(locationFeatureSchema),
  activity: z.array(activityEntrySchema),
  serverTime: z.string(),
});
export type SceneResponse = z.infer<typeof sceneResponseSchema>;
