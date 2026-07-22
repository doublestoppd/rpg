import { z } from 'zod';

/** The versioned content types the publishing platform manages (Phase 19). */
export const contentTypeSchema = z.enum([
  'ITEM',
  'LOCATION',
  'TRAVEL_ROUTE',
  'LOCATION_FEATURE',
  'REGIONAL_PRICE_MODIFIER',
  'NPC_SHOP',
  'GATHERING_ACTION',
  'CRAFTING_RECIPE',
  'ENEMY',
  'ENCOUNTER',
  'QUEST',
  'COLLECTION',
  'CHARACTER_CLASS',
  'LEVEL_PROGRESSION',
  'NPC',
  'NPC_PLACEMENT',
  'DIALOGUE',
  'NARRATIVE_FLAG',
  'WORLD_EVENT',
]);
export type ContentType = z.infer<typeof contentTypeSchema>;

export const contentReleaseStatusSchema = z.enum(['DRAFT', 'VALIDATING', 'PUBLISHED', 'RETIRED']);
export type ContentReleaseStatus = z.infer<typeof contentReleaseStatusSchema>;

/** One definition inside a bundle: a stable key + canonical payload. */
export const contentDefinitionEntrySchema = z.object({
  type: contentTypeSchema,
  key: z.string().min(1),
  revision: z.number().int().min(1).default(1),
  payload: z.record(z.string(), z.unknown()),
});
export type ContentDefinitionEntry = z.infer<typeof contentDefinitionEntrySchema>;

/**
 * A deterministic, validated content bundle: the unit of export and import.
 * `definitions` is sorted by (type, key); `formatVersion` guards the encoding.
 */
export const contentBundleSchema = z.object({
  formatVersion: z.literal(1),
  title: z.string().min(1),
  definitions: z.array(contentDefinitionEntrySchema),
});
export type ContentBundle = z.infer<typeof contentBundleSchema>;

export const contentReleaseSummarySchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  status: contentReleaseStatusSchema,
  title: z.string(),
  notes: z.string().nullable(),
  definitionCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(),
  retiredAt: z.iso.datetime().nullable(),
});
export type ContentReleaseSummary = z.infer<typeof contentReleaseSummarySchema>;

export const contentReleasesResponseSchema = z.object({
  releases: z.array(contentReleaseSummarySchema),
});
export type ContentReleasesResponse = z.infer<typeof contentReleasesResponseSchema>;

/** A single dependency edge: `from` references `to` by stable key. */
export const contentDependencyEdgeSchema = z.object({
  fromType: contentTypeSchema,
  fromKey: z.string(),
  toType: contentTypeSchema,
  toKey: z.string(),
});
export type ContentDependencyEdge = z.infer<typeof contentDependencyEdgeSchema>;

/** A content validation problem (error blocks publication; warning does not). */
export const contentViolationSchema = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  type: contentTypeSchema.nullable(),
  key: z.string().nullable(),
  message: z.string(),
});
export type ContentViolation = z.infer<typeof contentViolationSchema>;

export const contentValidationResultSchema = z.object({
  ok: z.boolean(),
  violations: z.array(contentViolationSchema),
});
export type ContentValidationResult = z.infer<typeof contentValidationResultSchema>;
