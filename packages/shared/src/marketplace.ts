import { z } from 'zod';

import { goldStringSchema } from './currency.js';
import { itemCategorySchema, itemDefinitionSchema } from './items.js';
import { idempotencyKeySchema } from './travel.js';

export const shopNameSchema = z
  .string()
  .trim()
  .min(3, 'Shop name must be at least 3 characters')
  .max(32, 'Shop name must be at most 32 characters');

export const createPlayerShopRequestSchema = z.object({
  name: shopNameSchema,
  description: z.string().trim().max(200).default(''),
  region: z.string().min(1),
});
export type CreatePlayerShopRequest = z.infer<typeof createPlayerShopRequestSchema>;

export const updatePlayerShopRequestSchema = z
  .object({
    name: shopNameSchema.optional(),
    description: z.string().trim().max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdatePlayerShopRequest = z.infer<typeof updatePlayerShopRequestSchema>;

export const playerShopSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  region: z.string(),
  createdAt: z.iso.datetime(),
});
export type PlayerShopInfo = z.infer<typeof playerShopSchema>;

export const createListingRequestSchema = z.object({
  /** Stack listings: item slug + quantity. Instance listings: instance id. */
  itemSlug: z.string().min(1).optional(),
  quantity: z.number().int().min(1).max(99).optional(),
  itemInstanceId: z.uuid().optional(),
  price: goldStringSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type CreateListingRequest = z.infer<typeof createListingRequestSchema>;

export const listingStatusSchema = z.enum(['ACTIVE', 'SOLD', 'CANCELED', 'EXPIRED']);

export const marketplaceListingSchema = z.object({
  id: z.uuid(),
  item: itemDefinitionSchema,
  quantity: z.number().int().min(1),
  price: goldStringSchema,
  status: listingStatusSchema,
  shopName: z.string(),
  shopRegion: z.string(),
  /** True when the listing's shop region matches your current region. */
  local: z.boolean(),
  isYours: z.boolean(),
  expiresAt: z.iso.datetime(),
});
export type MarketplaceListingInfo = z.infer<typeof marketplaceListingSchema>;

export const marketplaceListingsResponseSchema = z.object({
  listings: z.array(marketplaceListingSchema),
});
export type MarketplaceListingsResponse = z.infer<typeof marketplaceListingsResponseSchema>;

export const listingsQuerySchema = z.object({
  /** Free-text search over item display name or slug (case-insensitive, partial). */
  search: z.string().trim().max(120).optional(),
  category: itemCategorySchema.optional(),
  mine: z.coerce.boolean().optional(),
});
export type ListingsQuery = z.infer<typeof listingsQuerySchema>;

export const purchaseListingRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});
export type PurchaseListingRequest = z.infer<typeof purchaseListingRequestSchema>;

export const purchaseListingResponseSchema = z.object({
  saleId: z.uuid(),
  remote: z.boolean(),
  grossPrice: goldStringSchema,
  shippingFee: goldStringSchema,
  totalCharged: goldStringSchema,
  gold: goldStringSchema,
  /** Present for remote purchases. */
  deliveryArrivesAt: z.iso.datetime().nullable(),
});
export type PurchaseListingResponse = z.infer<typeof purchaseListingResponseSchema>;

export const marketSummarySchema = z.object({
  itemSlug: z.string(),
  activeListings: z.number().int().min(0),
  cheapestPrice: goldStringSchema.nullable(),
  recentSales: z.number().int().min(0),
  /** Median per-unit price of recent sales; null with insufficient history. */
  medianUnitPrice: goldStringSchema.nullable(),
  /** Units sold across recent sales. */
  volume: z.number().int().min(0),
  insufficientHistory: z.boolean(),
});
export type MarketSummary = z.infer<typeof marketSummarySchema>;

export const deliveryStatusSchema = z.enum(['IN_TRANSIT', 'DELIVERED']);

export const deliverySchema = z.object({
  id: z.uuid(),
  status: deliveryStatusSchema,
  arrivesAt: z.iso.datetime(),
  remainingSeconds: z.number().int().min(0),
  lines: z.array(
    z.object({
      itemName: z.string(),
      itemSlug: z.string(),
      quantity: z.number().int().min(1),
    }),
  ),
});
export type DeliveryInfo = z.infer<typeof deliverySchema>;

export const deliveriesResponseSchema = z.object({
  deliveries: z.array(deliverySchema),
});
export type DeliveriesResponse = z.infer<typeof deliveriesResponseSchema>;

export const regionsResponseSchema = z.object({
  regions: z.array(z.string()),
});
export type RegionsResponse = z.infer<typeof regionsResponseSchema>;
