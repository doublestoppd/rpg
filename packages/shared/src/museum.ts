import { z } from 'zod';

import { itemDefinitionSchema } from './items.js';

export const collectionEntryViewSchema = z.object({
  item: itemDefinitionSchema,
  /** Whether THIS character has donated the entry. */
  donated: z.boolean(),
  donatedAt: z.iso.datetime().nullable(),
  /** Revealed once donated. */
  curatorNote: z.string().nullable(),
  /** Copies in the character's active inventory available to donate. */
  ownedCount: z.number().int().min(0),
});
export type CollectionEntryView = z.infer<typeof collectionEntryViewSchema>;

export const collectionViewSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  /** Location that accepts donations for this collection. */
  locationSlug: z.string(),
  entries: z.array(collectionEntryViewSchema),
  donatedCount: z.number().int().min(0),
  totalCount: z.number().int().min(1),
});
export type CollectionView = z.infer<typeof collectionViewSchema>;

export const collectionsResponseSchema = z.object({
  collections: z.array(collectionViewSchema),
});
export type CollectionsResponse = z.infer<typeof collectionsResponseSchema>;

export const donateRequestSchema = z.object({
  itemSlug: z.string().min(1),
});
export type DonateRequest = z.infer<typeof donateRequestSchema>;

export const donateResponseSchema = z.object({
  collection: collectionViewSchema,
  /** The entry just donated, with its revealed curator note. */
  entry: collectionEntryViewSchema,
});
export type DonateResponse = z.infer<typeof donateResponseSchema>;
