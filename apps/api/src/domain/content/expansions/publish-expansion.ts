import type { PrismaClient } from '@prisma/client';
import type { ContentBundle } from '@rpg/shared';

import { canonicalize, checksumOf } from '../canonical.js';
import { applyBundle } from '../content-apply.js';
import { exportBundle } from '../content-export.js';
import { validateBundle } from '../content-validate.js';
import { NORTHMARCH_DEFINITIONS, NORTHMARCH_RELEASE_TITLE } from './northmarch.js';

/**
 * Builds the full Northmarch release bundle: the current live content plus the
 * Northmarch additions (Phase 22). It is a complete bundle — not a delta — so
 * every reference resolves and validation passes, exactly as when an
 * administrator clones the live content in the Studio and adds to it.
 */
export async function buildNorthmarchBundle(prisma: PrismaClient): Promise<ContentBundle> {
  const live = await exportBundle(prisma, NORTHMARCH_RELEASE_TITLE);
  return { ...live, definitions: [...live.definitions, ...NORTHMARCH_DEFINITIONS] };
}

/**
 * Idempotently publishes the Northmarch expansion through the content platform:
 * validate the full bundle, store it as a release, and apply it to the live
 * tables the engine reads (apply-on-publish, Phase 20). This is the operator/
 * bootstrap path; in the Studio an administrator does the same via a draft.
 */
export async function ensureNorthmarchPublished(
  prisma: PrismaClient,
): Promise<{ created: boolean; version: number }> {
  const existing = await prisma.contentRelease.findFirst({
    where: { title: NORTHMARCH_RELEASE_TITLE },
    orderBy: { version: 'desc' },
  });
  if (existing) return { created: false, version: existing.version };

  const bundle = await buildNorthmarchBundle(prisma);
  const result = validateBundle(bundle);
  if (!result.ok) {
    const first = result.violations.find((v) => v.severity === 'error');
    throw new Error(
      `Northmarch content is invalid: ${first?.code} — ${first?.message ?? 'unknown'}`,
    );
  }

  const version = await prisma.$transaction(async (tx) => {
    const top = await tx.contentRelease.findFirst({ orderBy: { version: 'desc' } });
    const nextVersion = (top?.version ?? 0) + 1;
    const release = await tx.contentRelease.create({
      data: { version: nextVersion, title: bundle.title, status: 'DRAFT' },
    });
    for (const def of bundle.definitions) {
      await tx.contentDefinition.create({
        data: {
          releaseId: release.id,
          contentType: def.type,
          stableKey: def.key,
          revision: def.revision,
          payload: canonicalize(def.payload) as never,
          checksum: checksumOf(def.payload),
        },
      });
    }
    // Materialize into the live gameplay tables, then seal the release.
    await applyBundle(tx, bundle);
    await tx.contentRelease.update({
      where: { id: release.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    return nextVersion;
  });

  return { created: true, version };
}
