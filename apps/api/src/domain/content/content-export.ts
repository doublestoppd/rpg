import type { PrismaClient } from '@prisma/client';
import type { ContentBundle, ContentDefinitionEntry } from '@rpg/shared';

import { canonicalize } from './canonical.js';
import { CONTENT_TYPE_SPECS } from './content-types.js';

/**
 * Builds a deterministic content bundle from the live gameplay tables (Phase
 * 19). References are expressed by stable key; payloads are canonicalized so
 * the output is byte-stable. This does not modify any gameplay state.
 */
export async function exportBundle(prisma: PrismaClient, title: string): Promise<ContentBundle> {
  const definitions: ContentDefinitionEntry[] = [];
  for (const spec of CONTENT_TYPE_SPECS) {
    const exported = await spec.exportAll(prisma);
    for (const def of exported) {
      definitions.push({
        type: spec.type,
        key: def.key,
        revision: 1,
        payload: canonicalize(def.payload) as Record<string, unknown>,
      });
    }
  }
  // Stable order: by type (registry order) then key. Within a type exportAll
  // already sorts by key; the outer loop preserves registry order.
  return { formatVersion: 1, title, definitions };
}
