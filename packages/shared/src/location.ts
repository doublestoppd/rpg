import { z } from 'zod';

export const locationFeatureTypeSchema = z.enum([
  'INN',
  'NPC_SHOP',
  'MARKETPLACE',
  'GATHERING',
  'CRAFTING',
  'COMBAT',
  'QUEST',
  'MUSEUM',
]);
export type LocationFeatureType = z.infer<typeof locationFeatureTypeSchema>;

export const locationSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  region: z.string(),
  description: z.string(),
  artworkKey: z.string(),
  isSafe: z.boolean(),
});
export type LocationInfo = z.infer<typeof locationSchema>;

export const locationFeatureSchema = z.object({
  id: z.uuid(),
  type: locationFeatureTypeSchema,
  name: z.string(),
  description: z.string(),
  /** For INN features: the level-scaled rest fee in Gold (decimal string). */
  restFee: z.string().regex(/^\d+$/).nullable().default(null),
});
export type LocationFeatureInfo = z.infer<typeof locationFeatureSchema>;

export const currentLocationResponseSchema = z.object({
  location: locationSchema,
});
export type CurrentLocationResponse = z.infer<typeof currentLocationResponseSchema>;

export const locationFeaturesResponseSchema = z.object({
  features: z.array(locationFeatureSchema),
});
export type LocationFeaturesResponse = z.infer<typeof locationFeaturesResponseSchema>;

export const travelDestinationSchema = z.object({
  location: locationSchema,
  travelSeconds: z.number().int().min(1),
  /** Gold cost as a decimal string; zero until Phase 8. */
  goldCost: z.string().regex(/^\d+$/),
});
export type TravelDestination = z.infer<typeof travelDestinationSchema>;

export const travelDestinationsResponseSchema = z.object({
  destinations: z.array(travelDestinationSchema),
});
export type TravelDestinationsResponse = z.infer<typeof travelDestinationsResponseSchema>;

// --- world map -------------------------------------------------------------

/** A single directed road on the world map. */
export const worldMapEdgeSchema = z.object({
  fromSlug: z.string(),
  toSlug: z.string(),
  travelSeconds: z.number().int().min(1),
});
export type WorldMapEdge = z.infer<typeof worldMapEdgeSchema>;

/** A location as a positioned node on the world-map canvas. */
export const worldMapNodeSchema = z.object({
  slug: z.string(),
  name: z.string(),
  region: z.string(),
  isSafe: z.boolean(),
  /** Canvas coordinates (unitless; larger x is east, larger y is south). */
  x: z.number().int(),
  y: z.number().int(),
});
export type WorldMapNode = z.infer<typeof worldMapNodeSchema>;

/**
 * The whole navigable world topology: every location (positioned) and every
 * road between them, plus the caller's current location (null while traveling).
 * Read-only public geography — it carries no per-player state beyond that
 * pointer.
 */
export const worldMapResponseSchema = z.object({
  locations: z.array(worldMapNodeSchema),
  edges: z.array(worldMapEdgeSchema),
  currentLocationSlug: z.string().nullable(),
});
export type WorldMapResponse = z.infer<typeof worldMapResponseSchema>;
