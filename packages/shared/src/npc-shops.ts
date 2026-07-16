import { z } from 'zod';

import { goldStringSchema } from './currency.js';
import { itemDefinitionSchema } from './items.js';
import { idempotencyKeySchema } from './travel.js';

/** Approximate availability; exact quantities and restock times stay private. */
export const stockLevelSchema = z.enum(['PLENTY', 'SOME', 'LOW', 'SOLD_OUT']);
export type StockLevel = z.infer<typeof stockLevelSchema>;

export const npcShopSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
});
export type NpcShopSummary = z.infer<typeof npcShopSummarySchema>;

export const npcShopListResponseSchema = z.object({
  shops: z.array(npcShopSummarySchema),
});
export type NpcShopListResponse = z.infer<typeof npcShopListResponseSchema>;

export const npcShopStockEntrySchema = z.object({
  id: z.uuid(),
  item: itemDefinitionSchema,
  unitPrice: goldStringSchema,
  stockLevel: stockLevelSchema,
  perCharacterLimit: z.number().int().min(1),
  /** Units this character already bought from this entry (this restock). */
  purchasedByYou: z.number().int().min(0),
});
export type NpcShopStockEntryInfo = z.infer<typeof npcShopStockEntrySchema>;

export const npcShopDetailResponseSchema = z.object({
  shop: npcShopSummarySchema,
  stock: z.array(npcShopStockEntrySchema),
});
export type NpcShopDetailResponse = z.infer<typeof npcShopDetailResponseSchema>;

export const npcShopPurchaseRequestSchema = z.object({
  stockEntryId: z.uuid(),
  quantity: z.number().int().min(1).max(99),
  idempotencyKey: idempotencyKeySchema,
});
export type NpcShopPurchaseRequest = z.infer<typeof npcShopPurchaseRequestSchema>;

export const npcShopPurchaseResponseSchema = z.object({
  purchaseId: z.uuid(),
  itemSlug: z.string(),
  quantity: z.number().int().min(1),
  totalPrice: goldStringSchema,
  gold: goldStringSchema,
});
export type NpcShopPurchaseResponse = z.infer<typeof npcShopPurchaseResponseSchema>;
