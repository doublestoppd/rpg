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
