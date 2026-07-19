import { z } from 'zod';

import {
  contentDependencyEdgeSchema,
  contentReleaseSummarySchema,
  contentTypeSchema,
  contentValidationResultSchema,
} from './content.js';

/**
 * Admin Content Studio contract (Phase 20). The studio drives the Phase 19
 * content platform: administrators create drafts, edit definitions with
 * domain-specific validation, preview, and publish or retire releases. All
 * mutations are audited; publication is atomic, reauthenticated, and version-
 * and idempotency-guarded.
 */

const stableKey = z.string().min(1).max(200);
const reason = z.string().trim().min(3).max(500);
const idempotencyKey = z.string().trim().min(8).max(200);

// --- draft authoring -------------------------------------------------------

/** Create a draft release, cloned from the live content or a prior release. */
export const adminCreateDraftRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  /** Omit to seed the draft from the current live content. */
  fromReleaseId: z.uuid().optional(),
});
export type AdminCreateDraftRequest = z.infer<typeof adminCreateDraftRequestSchema>;

/** Create or replace one definition in a draft; payload is domain-validated. */
export const adminUpsertDefinitionRequestSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
});
export type AdminUpsertDefinitionRequest = z.infer<typeof adminUpsertDefinitionRequestSchema>;

// --- reads -----------------------------------------------------------------

/** A definition row as the catalog shows it (payload included for editing). */
export const adminContentDefinitionSchema = z.object({
  type: contentTypeSchema,
  key: stableKey,
  revision: z.number().int().min(1),
  checksum: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type AdminContentDefinition = z.infer<typeof adminContentDefinitionSchema>;

/** A catalog entry (no payload) for searchable, paginated lists. */
export const adminContentCatalogEntrySchema = z.object({
  type: contentTypeSchema,
  key: stableKey,
  revision: z.number().int().min(1),
  checksum: z.string(),
  name: z.string(),
});
export type AdminContentCatalogEntry = z.infer<typeof adminContentCatalogEntrySchema>;

export const adminReleaseDetailSchema = z.object({
  release: contentReleaseSummarySchema,
  definitions: z.array(adminContentCatalogEntrySchema),
});
export type AdminReleaseDetail = z.infer<typeof adminReleaseDetailSchema>;

/** Validation result plus the systems each error/warning affects (dependents). */
export const adminContentValidationSchema = z.object({
  result: contentValidationResultSchema,
  edges: z.array(contentDependencyEdgeSchema),
});
export type AdminContentValidation = z.infer<typeof adminContentValidationSchema>;

/** A change relative to the current published release. */
export const adminContentDiffEntrySchema = z.object({
  type: contentTypeSchema,
  key: stableKey,
  change: z.enum(['added', 'changed', 'removed']),
});
export type AdminContentDiffEntry = z.infer<typeof adminContentDiffEntrySchema>;

export const adminContentDiffSchema = z.object({
  againstReleaseId: z.uuid().nullable(),
  entries: z.array(adminContentDiffEntrySchema),
});
export type AdminContentDiff = z.infer<typeof adminContentDiffSchema>;

/** "Where used": the definitions that reference a given (type, key). */
export const adminWhereUsedSchema = z.object({
  type: contentTypeSchema,
  key: stableKey,
  usedBy: z.array(z.object({ type: contentTypeSchema, key: stableKey })),
});
export type AdminWhereUsed = z.infer<typeof adminWhereUsedSchema>;

/** A preview of one definition with its references resolved in the draft. */
export const adminContentPreviewSchema = z.object({
  type: contentTypeSchema,
  key: stableKey,
  payload: z.record(z.string(), z.unknown()),
  references: z.array(z.object({ type: contentTypeSchema, key: stableKey, resolved: z.boolean() })),
});
export type AdminContentPreview = z.infer<typeof adminContentPreviewSchema>;

// --- lifecycle mutations ---------------------------------------------------

export const adminPublishReleaseRequestSchema = z.object({
  reason,
  /** The release version the administrator intends to publish (optimistic). */
  expectedVersion: z.number().int().min(1),
  idempotencyKey,
});
export type AdminPublishReleaseRequest = z.infer<typeof adminPublishReleaseRequestSchema>;

export const adminRetireReleaseRequestSchema = z.object({ reason, idempotencyKey });
export type AdminRetireReleaseRequest = z.infer<typeof adminRetireReleaseRequestSchema>;

/** Roll forward the content of a prior release as a new draft, then publish. */
export const adminRollbackRequestSchema = z.object({
  toReleaseId: z.uuid(),
  reason,
  idempotencyKey,
});
export type AdminRollbackRequest = z.infer<typeof adminRollbackRequestSchema>;

export const adminReleaseResponseSchema = z.object({ release: contentReleaseSummarySchema });
export type AdminReleaseResponse = z.infer<typeof adminReleaseResponseSchema>;
