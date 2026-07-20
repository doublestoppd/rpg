import type { ContentType } from '@rpg/shared';

import type { ContentRef } from './content-types.js';

/**
 * Dialogue graph analysis (Phase 26). Pure helpers over a dialogue payload:
 * the content references it declares (for the dependency graph) and the
 * structural defects publication must reject (bad targets, unreachable nodes,
 * cycles).
 */

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

interface Choice {
  to: string | null;
  conditions: Record<string, unknown>[];
  effects: Record<string, unknown>[];
}
interface Node {
  id: string;
  choices: Choice[];
}

function parse(payload: Record<string, unknown>): { entry: string; nodes: Node[] } {
  const nodes = asArray(payload['nodes']).map((n) => {
    const node = asRecord(n);
    return {
      id: String(node['id']),
      choices: asArray(node['choices']).map((c) => {
        const choice = asRecord(c);
        return {
          to: typeof choice['to'] === 'string' ? choice['to'] : null,
          conditions: asArray(choice['conditions']).map(asRecord),
          effects: asArray(choice['effects']).map(asRecord),
        };
      }),
    };
  });
  return { entry: String(payload['entryNodeId']), nodes };
}

/** Content references a dialogue declares (items, quests, narrative flags). */
export function dialogueDependencies(payload: Record<string, unknown>): ContentRef[] {
  const refs: ContentRef[] = [];
  const add = (type: ContentType, key: string) => refs.push({ type, key });
  for (const node of parse(payload).nodes) {
    for (const choice of node.choices) {
      for (const cond of choice.conditions) {
        if (cond['type'] === 'HAS_ITEM') add('ITEM', String(cond['itemSlug']));
        if (cond['type'] === 'QUEST_STATUS') add('QUEST', String(cond['questSlug']));
        if (cond['type'] === 'FLAG_EQUALS') add('NARRATIVE_FLAG', String(cond['flagKey']));
      }
      for (const eff of choice.effects) {
        if (eff['type'] === 'SET_FLAG') add('NARRATIVE_FLAG', String(eff['flagKey']));
      }
    }
  }
  return refs;
}

export interface DialogueGraphIssue {
  code: 'MISSING_ENTRY' | 'BAD_TARGET' | 'UNREACHABLE_NODE' | 'DIALOGUE_CYCLE';
  message: string;
}

/**
 * Structural validation: the entry node exists, every choice target resolves,
 * every node is reachable from the entry, and the graph is acyclic (no
 * unbounded loops). Returns the issues found (empty when the graph is sound).
 */
export function validateDialogueGraph(payload: Record<string, unknown>): DialogueGraphIssue[] {
  const { entry, nodes } = parse(payload);
  const issues: DialogueGraphIssue[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  if (!byId.has(entry)) {
    issues.push({ code: 'MISSING_ENTRY', message: `Entry node "${entry}" does not exist.` });
    return issues;
  }

  for (const node of nodes) {
    for (const choice of node.choices) {
      if (choice.to !== null && !byId.has(choice.to)) {
        issues.push({
          code: 'BAD_TARGET',
          message: `Node "${node.id}" has a choice to missing node "${choice.to}".`,
        });
      }
    }
  }

  // Reachability from the entry (only following resolvable targets).
  const reachable = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const choice of byId.get(id)?.choices ?? []) {
      if (choice.to !== null && byId.has(choice.to)) stack.push(choice.to);
    }
  }
  for (const node of nodes) {
    if (!reachable.has(node.id)) {
      issues.push({
        code: 'UNREACHABLE_NODE',
        message: `Node "${node.id}" is unreachable from the entry node.`,
      });
    }
  }

  // Acyclicity via DFS coloring (white/grey/black); a grey re-visit is a cycle.
  const state = new Map<string, 0 | 1 | 2>();
  const hasCycle = (id: string): boolean => {
    state.set(id, 1);
    for (const choice of byId.get(id)?.choices ?? []) {
      if (choice.to === null || !byId.has(choice.to)) continue;
      const c = state.get(choice.to) ?? 0;
      if (c === 1) return true;
      if (c === 0 && hasCycle(choice.to)) return true;
    }
    state.set(id, 2);
    return false;
  };
  if (hasCycle(entry)) {
    issues.push({
      code: 'DIALOGUE_CYCLE',
      message: 'Dialogue graph contains a cycle (unbounded loop).',
    });
  }

  return issues;
}
