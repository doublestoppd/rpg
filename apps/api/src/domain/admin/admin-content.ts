import type { ContentRelease, Prisma, PrismaClient } from '@prisma/client';
import type {
  AdminContentDefinition,
  AdminContentDiff,
  AdminContentPreview,
  AdminContentValidation,
  AdminCreateDraftRequest,
  AdminPublishReleaseRequest,
  AdminReleaseDetail,
  AdminRetireReleaseRequest,
  AdminRollbackRequest,
  AdminWhereUsed,
  ContentBundle,
  ContentReleasesResponse,
  ContentReleaseSummary,
  ContentType,
} from '@rpg/shared';

import { conflict, DomainError } from '../../lib/http-errors.js';
import { canonicalize, checksumOf } from '../content/canonical.js';
import { applyBundle } from '../content/content-apply.js';
import { exportBundle } from '../content/content-export.js';
import { buildDependencyGraph, dependentsOf } from '../content/content-graph.js';
import { CONTENT_TYPE_SPEC_BY_TYPE } from '../content/content-types.js';
import { validateBundle } from '../content/content-validate.js';
import { type AdminActor, isUniqueViolation, writeAudit } from './admin-audit.js';

const unknownRelease = () => new DomainError(404, 'UNKNOWN_RELEASE', 'No such content release.');
const notDraft = () => conflict('NOT_DRAFT', 'Only a DRAFT release can be edited or published.');
const unknownType = (t: string) =>
  new DomainError(400, 'UNKNOWN_CONTENT_TYPE', `Unknown content type ${t}.`);

/** A content bundle that failed validation (blocks publication). */
export class ContentValidationError extends DomainError {
  constructor(public readonly validation: AdminContentValidation) {
    super(422, 'CONTENT_INVALID', 'Content bundle failed validation.');
    this.name = 'ContentValidationError';
  }
}

function toSummary(
  r: ContentRelease & { _count?: { definitions: number } },
): ContentReleaseSummary {
  return {
    id: r.id,
    version: r.version,
    status: r.status,
    title: r.title,
    notes: r.notes,
    definitionCount: r._count?.definitions ?? 0,
    createdAt: r.createdAt.toISOString(),
    publishedAt: r.publishedAt?.toISOString() ?? null,
    retiredAt: r.retiredAt?.toISOString() ?? null,
  };
}

function payloadName(payload: Record<string, unknown>): string {
  const name = payload['name'];
  return typeof name === 'string' ? name : '';
}

export interface AdminContentService {
  listReleases(): Promise<ContentReleasesResponse>;
  createDraft(actor: AdminActor, input: AdminCreateDraftRequest): Promise<ContentReleaseSummary>;
  getRelease(releaseId: string): Promise<AdminReleaseDetail>;
  getDefinition(releaseId: string, type: string, key: string): Promise<AdminContentDefinition>;
  upsertDefinition(
    releaseId: string,
    type: string,
    key: string,
    payload: Record<string, unknown>,
  ): Promise<AdminContentDefinition>;
  removeDefinition(releaseId: string, type: string, key: string): Promise<{ removed: boolean }>;
  validateRelease(releaseId: string): Promise<AdminContentValidation>;
  diffRelease(releaseId: string): Promise<AdminContentDiff>;
  whereUsed(releaseId: string, type: string, key: string): Promise<AdminWhereUsed>;
  preview(releaseId: string, type: string, key: string): Promise<AdminContentPreview>;
  publish(
    actor: AdminActor,
    releaseId: string,
    input: AdminPublishReleaseRequest,
  ): Promise<ContentReleaseSummary>;
  retire(
    actor: AdminActor,
    releaseId: string,
    input: AdminRetireReleaseRequest,
  ): Promise<ContentReleaseSummary>;
  rollback(actor: AdminActor, input: AdminRollbackRequest): Promise<ContentReleaseSummary>;
}

export function createAdminContentService(prisma: PrismaClient): AdminContentService {
  async function loadRelease(releaseId: string): Promise<ContentRelease> {
    const release = await prisma.contentRelease.findUnique({ where: { id: releaseId } });
    if (!release) throw unknownRelease();
    return release;
  }

  async function bundleOf(releaseId: string): Promise<ContentBundle> {
    const release = await prisma.contentRelease.findUnique({
      where: { id: releaseId },
      include: { definitions: { orderBy: [{ contentType: 'asc' }, { stableKey: 'asc' }] } },
    });
    if (!release) throw unknownRelease();
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

  /** Inserts a DRAFT release and its definitions from a bundle. */
  async function insertDraft(
    tx: Prisma.TransactionClient,
    bundle: ContentBundle,
  ): Promise<ContentRelease> {
    const top = await tx.contentRelease.findFirst({ orderBy: { version: 'desc' } });
    const version = (top?.version ?? 0) + 1;
    const release = await tx.contentRelease.create({
      data: { version, title: bundle.title, status: 'DRAFT' },
    });
    for (const def of bundle.definitions) {
      await tx.contentDefinition.create({
        data: {
          releaseId: release.id,
          contentType: def.type,
          stableKey: def.key,
          revision: def.revision,
          payload: canonicalize(def.payload) as Prisma.InputJsonValue,
          checksum: checksumOf(def.payload),
        },
      });
    }
    return release;
  }

  function toValidation(bundle: ContentBundle): AdminContentValidation {
    return { result: validateBundle(bundle), edges: buildDependencyGraph(bundle) };
  }

  /** The current live/published baseline for diffs (highest published version). */
  async function currentPublished(): Promise<ContentRelease | null> {
    return prisma.contentRelease.findFirst({
      where: { status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
    });
  }

  return {
    async listReleases() {
      const rows = await prisma.contentRelease.findMany({
        include: { _count: { select: { definitions: true } } },
        orderBy: { version: 'desc' },
      });
      return { releases: rows.map(toSummary) };
    },

    async createDraft(actor, input) {
      const bundle = input.fromReleaseId
        ? { ...(await bundleOf(input.fromReleaseId)), title: input.title }
        : await exportBundle(prisma, input.title);
      const release = await prisma.$transaction(async (tx) => {
        const created = await insertDraft(tx, bundle);
        await writeAudit(tx, {
          actor,
          actionNamespace: 'content.draft.create',
          targetType: 'ContentRelease',
          targetId: created.id,
          reason: input.fromReleaseId
            ? `Cloned from release ${input.fromReleaseId}`
            : 'Cloned from live content',
          idempotencyKey: `draft-${created.id}`,
          after: {
            version: created.version,
            title: created.title,
            definitions: bundle.definitions.length,
          },
        });
        return created;
      });
      return toSummary({ ...release, _count: { definitions: bundle.definitions.length } });
    },

    async getRelease(releaseId) {
      const release = await prisma.contentRelease.findUnique({
        where: { id: releaseId },
        include: {
          _count: { select: { definitions: true } },
          definitions: { orderBy: [{ contentType: 'asc' }, { stableKey: 'asc' }] },
        },
      });
      if (!release) throw unknownRelease();
      return {
        release: toSummary(release),
        definitions: release.definitions.map((d) => ({
          type: d.contentType,
          key: d.stableKey,
          revision: d.revision,
          checksum: d.checksum,
          name: payloadName(d.payload as Record<string, unknown>),
        })),
      };
    },

    async getDefinition(releaseId, type, key) {
      const def = await prisma.contentDefinition.findUnique({
        where: {
          releaseId_contentType_stableKey: {
            releaseId,
            contentType: type as ContentType,
            stableKey: key,
          },
        },
      });
      if (!def)
        throw new DomainError(404, 'UNKNOWN_DEFINITION', 'No such definition in this release.');
      return {
        type: def.contentType,
        key: def.stableKey,
        revision: def.revision,
        checksum: def.checksum,
        payload: def.payload as Record<string, unknown>,
      };
    },

    async upsertDefinition(releaseId, type, key, payload) {
      const spec = CONTENT_TYPE_SPEC_BY_TYPE.get(type as ContentType);
      if (!spec) throw unknownType(type);
      const release = await loadRelease(releaseId);
      if (release.status !== 'DRAFT') throw notDraft();

      // Domain-specific structural validation (not a generic JSON editor).
      const parsed = spec.payloadSchema.safeParse(payload);
      if (!parsed.success) {
        throw new DomainError(
          422,
          'INVALID_PAYLOAD',
          `Invalid ${type}: ${parsed.error.issues[0]?.message ?? 'schema error'}.`,
        );
      }
      // A slug-keyed payload must agree with its stable key (no silent renames).
      const slug = payload['slug'];
      if (typeof slug === 'string' && slug !== key) {
        throw new DomainError(
          422,
          'KEY_MISMATCH',
          `Payload slug "${slug}" does not match key "${key}".`,
        );
      }

      const canonical = canonicalize(payload) as Prisma.InputJsonValue;
      const checksum = checksumOf(payload);
      const existing = await prisma.contentDefinition.findUnique({
        where: {
          releaseId_contentType_stableKey: {
            releaseId,
            contentType: type as ContentType,
            stableKey: key,
          },
        },
      });
      const revision = existing ? existing.revision + 1 : 1;
      const saved = await prisma.contentDefinition.upsert({
        where: {
          releaseId_contentType_stableKey: {
            releaseId,
            contentType: type as ContentType,
            stableKey: key,
          },
        },
        create: {
          releaseId,
          contentType: type as ContentType,
          stableKey: key,
          revision,
          payload: canonical,
          checksum,
        },
        update: { revision, payload: canonical, checksum },
      });
      return {
        type: saved.contentType,
        key: saved.stableKey,
        revision: saved.revision,
        checksum: saved.checksum,
        payload: saved.payload as Record<string, unknown>,
      };
    },

    async removeDefinition(releaseId, type, key) {
      const release = await loadRelease(releaseId);
      if (release.status !== 'DRAFT') throw notDraft();
      const result = await prisma.contentDefinition.deleteMany({
        where: { releaseId, contentType: type as ContentType, stableKey: key },
      });
      return { removed: result.count > 0 };
    },

    async validateRelease(releaseId) {
      return toValidation(await bundleOf(releaseId));
    },

    async diffRelease(releaseId) {
      const draft = await bundleOf(releaseId);
      const baseline = await currentPublished();
      const baseByKey = new Map<string, string>();
      if (baseline) {
        const base = await bundleOf(baseline.id);
        for (const d of base.definitions)
          baseByKey.set(`${d.type}::${d.key}`, checksumOf(d.payload));
      }
      const entries: AdminContentDiff['entries'] = [];
      const seen = new Set<string>();
      for (const d of draft.definitions) {
        const id = `${d.type}::${d.key}`;
        seen.add(id);
        const prior = baseByKey.get(id);
        if (prior === undefined) entries.push({ type: d.type, key: d.key, change: 'added' });
        else if (prior !== checksumOf(d.payload))
          entries.push({ type: d.type, key: d.key, change: 'changed' });
      }
      for (const [id] of baseByKey) {
        if (!seen.has(id)) {
          const [type, key] = id.split('::');
          entries.push({ type: type as ContentType, key: key!, change: 'removed' });
        }
      }
      return { againstReleaseId: baseline?.id ?? null, entries };
    },

    async whereUsed(releaseId, type, key) {
      const edges = buildDependencyGraph(await bundleOf(releaseId));
      return {
        type: type as ContentType,
        key,
        usedBy: dependentsOf(edges, type, key) as AdminWhereUsed['usedBy'],
      };
    },

    async preview(releaseId, type, key) {
      const bundle = await bundleOf(releaseId);
      const def = bundle.definitions.find((d) => d.type === type && d.key === key);
      if (!def)
        throw new DomainError(404, 'UNKNOWN_DEFINITION', 'No such definition in this release.');
      const present = new Set(bundle.definitions.map((d) => `${d.type}::${d.key}`));
      const spec = CONTENT_TYPE_SPEC_BY_TYPE.get(type as ContentType);
      const references = (spec?.dependencies(def.payload) ?? []).map((ref) => ({
        type: ref.type,
        key: ref.key,
        resolved: present.has(`${ref.type}::${ref.key}`),
      }));
      return { type: def.type, key: def.key, payload: def.payload, references };
    },

    async publish(actor, releaseId, input) {
      const currentSummary = async (): Promise<ContentReleaseSummary> =>
        toSummary(
          await prisma.contentRelease.findUniqueOrThrow({
            where: { id: releaseId },
            include: { _count: { select: { definitions: true } } },
          }),
        );

      const release = await loadRelease(releaseId);
      if (release.status !== 'DRAFT') {
        // A completed publish under this same key is an idempotent replay.
        const prior = await prisma.adminAuditLog.findUnique({
          where: {
            actorUserId_actionNamespace_idempotencyKey: {
              actorUserId: actor.userId,
              actionNamespace: 'content.publish',
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (prior && prior.targetId === releaseId) return currentSummary();
        throw notDraft();
      }
      if (release.version !== input.expectedVersion) {
        throw conflict(
          'STALE_VERSION',
          `Release changed; expected version ${input.expectedVersion}, current is ${release.version}.`,
        );
      }
      const bundle = await bundleOf(releaseId);
      const validation = toValidation(bundle);
      if (!validation.result.ok) throw new ContentValidationError(validation);

      try {
        const published = await prisma.$transaction(async (tx) => {
          // Materialize the content into the live gameplay tables FIRST, then
          // seal the release. Both commit atomically with the audit row.
          await applyBundle(tx, bundle);
          const flipped = await tx.contentRelease.updateMany({
            where: { id: releaseId, status: 'DRAFT' },
            data: { status: 'PUBLISHED', publishedAt: new Date(), notes: input.reason },
          });
          if (flipped.count === 0) throw notDraft();
          await writeAudit(tx, {
            actor,
            actionNamespace: 'content.publish',
            targetType: 'ContentRelease',
            targetId: releaseId,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            before: { status: 'DRAFT', version: release.version },
            after: {
              status: 'PUBLISHED',
              version: release.version,
              definitions: bundle.definitions.length,
            },
          });
          return tx.contentRelease.findUniqueOrThrow({
            where: { id: releaseId },
            include: { _count: { select: { definitions: true } } },
          });
        });
        return toSummary(published);
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Idempotent replay: the publish already happened under this key.
          const current = await prisma.contentRelease.findUniqueOrThrow({
            where: { id: releaseId },
            include: { _count: { select: { definitions: true } } },
          });
          return toSummary(current);
        }
        throw error;
      }
    },

    async retire(actor, releaseId, input) {
      await loadRelease(releaseId);
      try {
        const retired = await prisma.$transaction(async (tx) => {
          const flipped = await tx.contentRelease.updateMany({
            where: { id: releaseId, status: 'PUBLISHED' },
            data: { status: 'RETIRED', retiredAt: new Date(), notes: input.reason },
          });
          if (flipped.count === 0) {
            throw conflict('NOT_PUBLISHED', 'Only a PUBLISHED release can be retired.');
          }
          await writeAudit(tx, {
            actor,
            actionNamespace: 'content.retire',
            targetType: 'ContentRelease',
            targetId: releaseId,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            after: { status: 'RETIRED' },
          });
          return tx.contentRelease.findUniqueOrThrow({
            where: { id: releaseId },
            include: { _count: { select: { definitions: true } } },
          });
        });
        return toSummary(retired);
      } catch (error) {
        if (isUniqueViolation(error)) {
          const current = await prisma.contentRelease.findUniqueOrThrow({
            where: { id: releaseId },
            include: { _count: { select: { definitions: true } } },
          });
          return toSummary(current);
        }
        throw error;
      }
    },

    async rollback(actor, input) {
      // Roll forward: clone a prior release's content into a NEW draft, then
      // publish it (re-applying to the live tables) subject to validation. The
      // prior release's history is never rewritten.
      const source = await loadRelease(input.toReleaseId);
      const bundle = {
        ...(await bundleOf(input.toReleaseId)),
        title: `Rollback to release ${source.version}`,
      };
      const validation = toValidation(bundle);
      if (!validation.result.ok) throw new ContentValidationError(validation);
      try {
        const published = await prisma.$transaction(async (tx) => {
          const draft = await insertDraft(tx, bundle);
          await applyBundle(tx, bundle);
          await tx.contentRelease.update({
            where: { id: draft.id },
            data: { status: 'PUBLISHED', publishedAt: new Date(), notes: input.reason },
          });
          await writeAudit(tx, {
            actor,
            actionNamespace: 'content.rollback',
            targetType: 'ContentRelease',
            targetId: draft.id,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            after: { rolledBackTo: source.version, newVersion: draft.version },
          });
          return tx.contentRelease.findUniqueOrThrow({
            where: { id: draft.id },
            include: { _count: { select: { definitions: true } } },
          });
        });
        return toSummary(published);
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Replay: a rollback under this key already produced a release. Return
          // the newest published release as the stable result.
          const current = await prisma.contentRelease.findFirstOrThrow({
            where: { status: 'PUBLISHED' },
            orderBy: { version: 'desc' },
            include: { _count: { select: { definitions: true } } },
          });
          return toSummary(current);
        }
        throw error;
      }
    },
  };
}
