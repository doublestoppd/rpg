import type { ContentBundle, ContentDependencyEdge } from '@rpg/shared';

import { CONTENT_TYPE_SPEC_BY_TYPE } from './content-types.js';

const refKey = (type: string, key: string): string => `${type}::${key}`;

/**
 * Builds the dependency graph of a bundle: every stable-key reference a
 * definition declares becomes an edge (Phase 19). Used for "where used" views
 * (Phase 20), validation, and connectivity checks.
 */
export function buildDependencyGraph(bundle: ContentBundle): ContentDependencyEdge[] {
  const edges: ContentDependencyEdge[] = [];
  for (const def of bundle.definitions) {
    const spec = CONTENT_TYPE_SPEC_BY_TYPE.get(def.type);
    if (!spec) continue;
    for (const ref of spec.dependencies(def.payload)) {
      edges.push({ fromType: def.type, fromKey: def.key, toType: ref.type, toKey: ref.key });
    }
  }
  return edges;
}

/** Definitions that reference the given (type, key) — the "where used" set. */
export function dependentsOf(
  edges: ContentDependencyEdge[],
  type: string,
  key: string,
): Array<{ type: string; key: string }> {
  return edges
    .filter((e) => e.toType === type && e.toKey === key)
    .map((e) => ({ type: e.fromType, key: e.fromKey }));
}

/**
 * Location keys reachable from a start location over TRAVEL_ROUTE edges
 * (treated as undirected for connectivity). Used to detect disconnected world
 * subgraphs.
 */
export function reachableLocations(bundle: ContentBundle, startKey: string): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };
  for (const def of bundle.definitions) {
    if (def.type !== 'TRAVEL_ROUTE') continue;
    const from = String(def.payload['fromSlug']);
    const to = String(def.payload['toSlug']);
    addEdge(from, to);
    addEdge(to, from);
  }
  const seen = new Set<string>();
  const stack = [startKey];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adjacency.get(node) ?? []) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

export { refKey };
