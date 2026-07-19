import { z } from 'zod';

import { chatReportReasonSchema } from './chat.js';
import { goldStringSchema, signedGoldStringSchema } from './currency.js';
import { itemDefinitionSchema } from './items.js';
import { idempotencyKeySchema } from './travel.js';

/** Recent-auth window and metric-window bounds are documented server defaults. */
export const ADMIN_MAX_METRIC_WINDOW_DAYS = 90;
export const ADMIN_LIST_MAX_LIMIT = 50;

/** A mandatory bounded reason accompanies every admin mutation. */
export const adminReasonSchema = z.string().trim().min(3).max(500);

/** Opaque cursor pagination shared by every admin collection endpoint. */
export const adminCursorQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(ADMIN_LIST_MAX_LIMIT).default(25),
});
export type AdminCursorQuery = z.infer<typeof adminCursorQuerySchema>;

// --- session / reauth ------------------------------------------------------

export const adminSessionResponseSchema = z.object({
  role: z.enum(['USER', 'ADMIN']),
  /** ISO timestamp until which recent-auth is valid, or null if not fresh. */
  reauthValidUntil: z.iso.datetime().nullable(),
});
export type AdminSessionResponse = z.infer<typeof adminSessionResponseSchema>;

export const adminReauthRequestSchema = z.object({
  password: z.string().min(1).max(128),
});
export type AdminReauthRequest = z.infer<typeof adminReauthRequestSchema>;

export const adminReauthResponseSchema = z.object({
  reauthValidUntil: z.iso.datetime(),
});
export type AdminReauthResponse = z.infer<typeof adminReauthResponseSchema>;

// --- investigation reads ---------------------------------------------------

export const adminCharacterSearchQuerySchema = adminCursorQuerySchema.extend({
  /** Exact or prefix match against character name (bounded). */
  query: z.string().trim().min(1).max(64).optional(),
});
export type AdminCharacterSearchQuery = z.infer<typeof adminCharacterSearchQuerySchema>;

export const adminCharacterSummarySchema = z.object({
  characterId: z.uuid(),
  name: z.string(),
  level: z.number().int(),
  classSlug: z.string(),
  /** Minimized: a masked form of the account email, never the full address. */
  accountEmailMasked: z.string(),
  createdAt: z.iso.datetime(),
});
export type AdminCharacterSummary = z.infer<typeof adminCharacterSummarySchema>;

export const adminCharacterListResponseSchema = z.object({
  characters: z.array(adminCharacterSummarySchema),
  nextCursor: z.string().nullable(),
});
export type AdminCharacterListResponse = z.infer<typeof adminCharacterListResponseSchema>;

export const adminCharacterOverviewResponseSchema = z.object({
  characterId: z.uuid(),
  name: z.string(),
  level: z.number().int(),
  xp: z.number().int(),
  classSlug: z.string(),
  gold: goldStringSchema,
  currentLocationSlug: z.string().nullable(),
  accountEmailMasked: z.string(),
  accountRole: z.enum(['USER', 'ADMIN']),
  createdAt: z.iso.datetime(),
});
export type AdminCharacterOverviewResponse = z.infer<typeof adminCharacterOverviewResponseSchema>;

/** Date-bounded window shared by record listings that support it. */
export const adminDateWindowQuerySchema = adminCursorQuerySchema.extend({
  start: z.iso.datetime().optional(),
  end: z.iso.datetime().optional(),
});
export type AdminDateWindowQuery = z.infer<typeof adminDateWindowQuerySchema>;

export const adminLedgerEntrySchema = z.object({
  id: z.uuid(),
  amount: signedGoldStringSchema,
  balanceAfter: goldStringSchema,
  type: z.string(),
  createdAt: z.iso.datetime(),
});
export const adminCurrencyTransactionsResponseSchema = z.object({
  transactions: z.array(adminLedgerEntrySchema),
  nextCursor: z.string().nullable(),
});
export type AdminCurrencyTransactionsResponse = z.infer<
  typeof adminCurrencyTransactionsResponseSchema
>;

export const adminInventoryResponseSchema = z.object({
  stacks: z.array(z.object({ itemSlug: z.string(), name: z.string(), quantity: z.number().int() })),
  instances: z.array(
    z.object({
      id: z.uuid(),
      itemSlug: z.string(),
      name: z.string(),
      lockState: z.string(),
      equipped: z.boolean(),
    }),
  ),
});
export type AdminInventoryResponse = z.infer<typeof adminInventoryResponseSchema>;

export const adminItemTransferSchema = z.object({
  id: z.uuid(),
  itemSlug: z.string(),
  quantity: z.number().int(),
  fromCharacterId: z.uuid().nullable(),
  toCharacterId: z.uuid().nullable(),
  reason: z.string(),
  createdAt: z.iso.datetime(),
});
export const adminItemTransfersResponseSchema = z.object({
  transfers: z.array(adminItemTransferSchema),
  nextCursor: z.string().nullable(),
});
export type AdminItemTransfersResponse = z.infer<typeof adminItemTransfersResponseSchema>;

export const adminMarketplaceActivityResponseSchema = z.object({
  sales: z.array(
    z.object({
      id: z.uuid(),
      itemSlug: z.string(),
      quantity: z.number().int(),
      role: z.enum(['BUYER', 'SELLER']),
      grossPrice: goldStringSchema,
      createdAt: z.iso.datetime(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type AdminMarketplaceActivityResponse = z.infer<
  typeof adminMarketplaceActivityResponseSchema
>;

export const adminProgressResponseSchema = z.object({
  quests: z.array(z.object({ slug: z.string(), status: z.string() })),
  collections: z.array(z.object({ entrySlug: z.string(), donatedAt: z.iso.datetime() })),
  skills: z.array(z.object({ skill: z.string(), xp: z.number().int() })),
});
export type AdminProgressResponse = z.infer<typeof adminProgressResponseSchema>;

// --- economy operations ----------------------------------------------------

export const adminGoldAdjustmentRequestSchema = z.object({
  /** Signed decimal string; negative debits (never below zero). */
  amount: signedGoldStringSchema,
  reason: adminReasonSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type AdminGoldAdjustmentRequest = z.infer<typeof adminGoldAdjustmentRequestSchema>;

export const adminGoldAdjustmentResponseSchema = z.object({
  transactionId: z.uuid(),
  gold: goldStringSchema,
  auditId: z.uuid(),
});
export type AdminGoldAdjustmentResponse = z.infer<typeof adminGoldAdjustmentResponseSchema>;

export const adminItemGrantRequestSchema = z.object({
  itemSlug: z.string().min(1),
  quantity: z.number().int().min(1).max(999),
  reason: adminReasonSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type AdminItemGrantRequest = z.infer<typeof adminItemGrantRequestSchema>;

export const adminItemRemovalRequestSchema = z
  .object({
    /** Stack removal: item slug + quantity. Instance removal: instance id. */
    itemSlug: z.string().min(1).optional(),
    quantity: z.number().int().min(1).max(999).optional(),
    itemInstanceId: z.uuid().optional(),
    reason: adminReasonSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .refine((v) => Boolean(v.itemSlug) !== Boolean(v.itemInstanceId), {
    message: 'Provide either itemSlug (stack) or itemInstanceId (instance), not both',
  });
export type AdminItemRemovalRequest = z.infer<typeof adminItemRemovalRequestSchema>;

export const adminItemActionResponseSchema = z.object({
  auditId: z.uuid(),
});
export type AdminItemActionResponse = z.infer<typeof adminItemActionResponseSchema>;

// --- configuration (optimistic concurrency) --------------------------------

/** Only safe presentation/economic fields may be edited; structural fields
 *  (slug, stackability, slot, effect schema) are never mutable. */
export const adminItemDefinitionPatchSchema = z.object({
  expectedVersion: z.number().int().min(0),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  baseValue: goldStringSchema.optional(),
  reason: adminReasonSchema,
});
export type AdminItemDefinitionPatch = z.infer<typeof adminItemDefinitionPatchSchema>;

export const adminItemDefinitionResponseSchema = z.object({
  item: itemDefinitionSchema,
  configVersion: z.number().int(),
});
export type AdminItemDefinitionResponse = z.infer<typeof adminItemDefinitionResponseSchema>;

export const adminNpcShopConfigPatchSchema = z.object({
  expectedVersion: z.number().int().min(0),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  markupBps: z.number().int().min(10_000).max(100_000).optional(),
  reason: adminReasonSchema,
});
export type AdminNpcShopConfigPatch = z.infer<typeof adminNpcShopConfigPatchSchema>;

export const adminNpcShopResponseSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  markupBps: z.number().int(),
  sellbackBps: z.number().int(),
  configVersion: z.number().int(),
});
export type AdminNpcShopResponse = z.infer<typeof adminNpcShopResponseSchema>;

export const adminRestockRequestSchema = z.object({
  reason: adminReasonSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type AdminRestockRequest = z.infer<typeof adminRestockRequestSchema>;

export const adminRestockResponseSchema = z.object({
  restocked: z.boolean(),
  auditId: z.uuid(),
});
export type AdminRestockResponse = z.infer<typeof adminRestockResponseSchema>;

// --- economy metrics -------------------------------------------------------

export const adminMetricsQuerySchema = z.object({
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  itemSlug: z.string().min(1).optional(),
  locationSlug: z.string().min(1).optional(),
});
export type AdminMetricsQuery = z.infer<typeof adminMetricsQuerySchema>;

export const adminEconomyMetricsResponseSchema = z.object({
  window: z.object({ start: z.iso.datetime(), end: z.iso.datetime() }),
  /** Current authoritative totals (as of the query), decimal strings. */
  totalGold: goldStringSchema,
  /** Gold created/destroyed within the window (from the ledger). */
  goldSources: goldStringSchema,
  goldSinks: goldStringSchema,
  /** Marketplace within the window. */
  marketplaceGross: goldStringSchema,
  marketplaceTax: goldStringSchema,
  marketplaceShipping: goldStringSchema,
  marketplaceVolume: z.number().int(),
  /** NPC shop spending within the window. */
  npcSpending: goldStringSchema,
  /** Items generated/destroyed within the window (quantities). */
  itemsGenerated: z.number().int(),
  itemsDestroyed: z.number().int(),
  /** Active marketplace listings right now. */
  activeListings: z.number().int(),
  /** Median per-unit sale price within the window (null below the threshold). */
  medianUnitPrice: goldStringSchema.nullable(),
});
export type AdminEconomyMetricsResponse = z.infer<typeof adminEconomyMetricsResponseSchema>;

// --- chat moderation -------------------------------------------------------

export const adminChatReportStatusSchema = z.enum(['OPEN', 'RESOLVED', 'DISMISSED']);
export type AdminChatReportStatus = z.infer<typeof adminChatReportStatusSchema>;

export const adminChatReportsQuerySchema = adminCursorQuerySchema.extend({
  status: adminChatReportStatusSchema.optional(),
});
export type AdminChatReportsQuery = z.infer<typeof adminChatReportsQuerySchema>;

export const adminChatReportSchema = z.object({
  id: z.uuid(),
  reason: chatReportReasonSchema,
  details: z.string().nullable(),
  status: adminChatReportStatusSchema,
  /** Immutable evidence snapshot at report time. */
  snapshotBody: z.string(),
  snapshotAuthorCharacterId: z.uuid(),
  snapshotAuthorName: z.string(),
  messageId: z.uuid(),
  channelSlug: z.string(),
  /** Current tombstone state of the live message (null if not redacted). */
  messageRedactedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  resolutionReason: z.string().nullable(),
  // Deliberately NO reporter identity: reporter privacy.
});
export type AdminChatReport = z.infer<typeof adminChatReportSchema>;

export const adminChatReportsResponseSchema = z.object({
  reports: z.array(adminChatReportSchema),
  nextCursor: z.string().nullable(),
});
export type AdminChatReportsResponse = z.infer<typeof adminChatReportsResponseSchema>;

export const adminResolveReportRequestSchema = z.object({
  resolution: z.enum(['RESOLVED', 'DISMISSED']),
  reason: adminReasonSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type AdminResolveReportRequest = z.infer<typeof adminResolveReportRequestSchema>;

export const adminRedactMessageRequestSchema = z.object({
  reason: adminReasonSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type AdminRedactMessageRequest = z.infer<typeof adminRedactMessageRequestSchema>;

export const adminCreateRestrictionRequestSchema = z.object({
  characterId: z.uuid(),
  reason: adminReasonSchema,
  /** Null/omitted = indefinite. */
  expiresAt: z.iso.datetime().optional(),
  idempotencyKey: idempotencyKeySchema,
});
export type AdminCreateRestrictionRequest = z.infer<typeof adminCreateRestrictionRequestSchema>;

export const adminRestrictionResponseSchema = z.object({
  restrictionId: z.uuid(),
  auditId: z.uuid(),
});
export type AdminRestrictionResponse = z.infer<typeof adminRestrictionResponseSchema>;

export const adminRevokeRestrictionRequestSchema = z.object({
  reason: adminReasonSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type AdminRevokeRestrictionRequest = z.infer<typeof adminRevokeRestrictionRequestSchema>;

export const adminModerationResponseSchema = z.object({
  auditId: z.uuid(),
});
export type AdminModerationResponse = z.infer<typeof adminModerationResponseSchema>;
