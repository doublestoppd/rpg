import type { ContentRelease, Prisma, PrismaClient } from '@prisma/client';
import {
  type ContentBundle,
  contentBundleSchema,
  type ContentReleasesResponse,
  type ContentReleaseSummary,
  type ContentValidationResult,
} from '@rpg/shared';

import { conflict, DomainError } from '../../lib/http-errors.js';
import { canonicalize, checksumOf } from './canonical.js';
import { exportBundle } from './content-export.js';
import { validateBundle } from './content-validate.js';

export const RELEASE_1_TITLE = 'Release 1 — seeded content';

export class ContentValidationError extends DomainError {
  constructor(public readonly result: ContentValidationResult) {
    super(422, 'CONTENT_INVALID', 'Content bundle failed validation.');
    this.name = 'ContentValidationError';
  }
}

function toSummary(
  release: ContentRelease & { _count?: { definitions: number } },
): ContentReleaseSummary {
  return {
    id: release.id,
    version: release.version,
    status: release.status,
    title: release.title,
    notes: release.notes,
    definitionCount: release._count?.definitions ?? 0,
    createdAt: release.createdAt.toISOString(),
    publishedAt: release.publishedAt?.toISOString() ?? null,
    retiredAt: release.retiredAt?.toISOString() ?? null,
  };
}

export interface ContentService {
  exportCurrent(title: string): Promise<ContentBundle>;
  validate(bundle: ContentBundle): ContentValidationResult;
  importDraft(bundle: ContentBundle): Promise<ContentReleaseSummary>;
  publish(releaseId: string, notes: string): Promise<ContentReleaseSummary>;
  retire(releaseId: string, notes: string): Promise<ContentReleaseSummary>;
  listReleases(): Promise<ContentReleasesResponse>;
  getReleaseBundle(releaseId: string): Promise<ContentBundle>;
  /** Idempotent: snapshot current content as a PUBLISHED Release 1 if absent. */
  ensureRelease1(): Promise<{ created: boolean; version: number }>;
}

export function createContentService(prisma: PrismaClient): ContentService {
  async function nextVersion(tx: Prisma.TransactionClient): Promise<number> {
    const top = await tx.contentRelease.findFirst({ orderBy: { version: 'desc' } });
    return (top?.version ?? 0) + 1;
  }

  /** Inserts a release + its definitions, then flips it to a final status. */
  async function insertRelease(
    tx: Prisma.TransactionClient,
    bundle: ContentBundle,
    status: 'DRAFT' | 'PUBLISHED',
  ): Promise<ContentRelease> {
    const version = await nextVersion(tx);
    const release = await tx.contentRelease.create({
      data: { version, title: bundle.title, status: 'DRAFT' },
    });
    for (const def of bundle.definitions) {
      const payload = canonicalize(def.payload) as Prisma.InputJsonValue;
      await tx.contentDefinition.create({
        data: {
          releaseId: release.id,
          contentType: def.type,
          stableKey: def.key,
          revision: def.revision,
          payload,
          checksum: checksumOf(def.payload),
        },
      });
    }
    if (status === 'PUBLISHED') {
      return tx.contentRelease.update({
        where: { id: release.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
    }
    return release;
  }

  async function bundleFromRelease(releaseId: string): Promise<ContentBundle> {
    const release = await prisma.contentRelease.findUnique({
      where: { id: releaseId },
      include: { definitions: { orderBy: [{ contentType: 'asc' }, { stableKey: 'asc' }] } },
    });
    if (!release) throw new DomainError(404, 'UNKNOWN_RELEASE', 'No such content release.');
    return {
      formatVersion: 1,
      title: release.title,
      definitions: release.definitions.map((d) => ({
        type: d.contentType,
        key: d.stableKey,
        revision: d.revision,
        payload: d.payload as Record<string, unknown>,
      })),
    };
  }

  return {
    exportCurrent: (title) => exportBundle(prisma, title),
    validate: (bundle) => validateBundle(bundle),

    async importDraft(bundle) {
      contentBundleSchema.parse(bundle);
      const result = validateBundle(bundle);
      if (!result.ok) throw new ContentValidationError(result);
      const release = await prisma.$transaction((tx) => insertRelease(tx, bundle, 'DRAFT'));
      return toSummary(release);
    },

    async publish(releaseId, notes) {
      // Re-validate from stored definitions, then atomically activate the whole
      // release with a conditional status flip (DRAFT -> PUBLISHED).
      const bundle = await bundleFromRelease(releaseId);
      const result = validateBundle(bundle);
      if (!result.ok) throw new ContentValidationError(result);
      const published = await prisma.$transaction(async (tx) => {
        const flipped = await tx.contentRelease.updateMany({
          where: { id: releaseId, status: 'DRAFT' },
          data: { status: 'PUBLISHED', publishedAt: new Date(), notes },
        });
        if (flipped.count === 0) {
          throw conflict('NOT_DRAFT', 'Only a DRAFT release can be published.');
        }
        return tx.contentRelease.findUniqueOrThrow({
          where: { id: releaseId },
          include: { _count: { select: { definitions: true } } },
        });
      });
      return toSummary(published);
    },

    async retire(releaseId, notes) {
      // Retirement changes only the release status; definitions (and any
      // historical records referencing them) are never destroyed.
      const retired = await prisma.$transaction(async (tx) => {
        const flipped = await tx.contentRelease.updateMany({
          where: { id: releaseId, status: 'PUBLISHED' },
          data: { status: 'RETIRED', retiredAt: new Date(), notes },
        });
        if (flipped.count === 0) {
          throw conflict('NOT_PUBLISHED', 'Only a PUBLISHED release can be retired.');
        }
        return tx.contentRelease.findUniqueOrThrow({
          where: { id: releaseId },
          include: { _count: { select: { definitions: true } } },
        });
      });
      return toSummary(retired);
    },

    async listReleases() {
      const rows = await prisma.contentRelease.findMany({
        include: { _count: { select: { definitions: true } } },
        orderBy: { version: 'desc' },
      });
      return { releases: rows.map(toSummary) };
    },

    getReleaseBundle: bundleFromRelease,

    async ensureRelease1() {
      const existing = await prisma.contentRelease.findFirst({ where: { version: 1 } });
      if (existing) return { created: false, version: 1 };
      const bundle = await exportBundle(prisma, RELEASE_1_TITLE);
      const result = validateBundle(bundle);
      if (!result.ok) {
        // The seeded content must always validate; surface the first error.
        const first = result.violations.find((v) => v.severity === 'error');
        throw new Error(`Release 1 content is invalid: ${first?.message ?? 'unknown'}`);
      }
      await prisma.$transaction((tx) => insertRelease(tx, bundle, 'PUBLISHED'));
      return { created: true, version: 1 };
    },
  };
}
