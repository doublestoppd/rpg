import { describe, expect, it } from 'vitest';

import { dialogueDependencies, validateDialogueGraph } from './dialogue-graph.js';

/**
 * Dialogue graph analysis (Phase 26). Pure structural checks the content
 * platform runs before a dialogue can be published.
 */

const node = (id: string, choices: Array<{ id: string; to: string | null }>) => ({
  id,
  speaker: 'NPC',
  text: id,
  choices: choices.map((c) => ({ id: c.id, label: c.id, conditions: [], effects: [], to: c.to })),
});

describe('validateDialogueGraph', () => {
  it('accepts a sound acyclic tree with all nodes reachable', () => {
    const payload = {
      entryNodeId: 'a',
      nodes: [
        node('a', [
          { id: 'x', to: 'b' },
          { id: 'y', to: null },
        ]),
        node('b', [{ id: 'z', to: null }]),
      ],
    };
    expect(validateDialogueGraph(payload)).toEqual([]);
  });

  it('flags a missing entry node', () => {
    const issues = validateDialogueGraph({ entryNodeId: 'missing', nodes: [node('a', [])] });
    expect(issues.map((i) => i.code)).toContain('MISSING_ENTRY');
  });

  it('flags a choice pointing at a nonexistent node', () => {
    const issues = validateDialogueGraph({
      entryNodeId: 'a',
      nodes: [node('a', [{ id: 'x', to: 'ghost' }])],
    });
    expect(issues.map((i) => i.code)).toContain('BAD_TARGET');
  });

  it('flags an unreachable node', () => {
    const issues = validateDialogueGraph({
      entryNodeId: 'a',
      nodes: [node('a', [{ id: 'x', to: null }]), node('island', [{ id: 'y', to: null }])],
    });
    expect(issues.map((i) => i.code)).toContain('UNREACHABLE_NODE');
  });

  it('flags a cycle (unbounded loop)', () => {
    const issues = validateDialogueGraph({
      entryNodeId: 'a',
      nodes: [node('a', [{ id: 'x', to: 'b' }]), node('b', [{ id: 'y', to: 'a' }])],
    });
    expect(issues.map((i) => i.code)).toContain('DIALOGUE_CYCLE');
  });
});

describe('dialogueDependencies', () => {
  it('extracts item, quest, and narrative-flag references from rules', () => {
    const payload = {
      entryNodeId: 'a',
      nodes: [
        {
          id: 'a',
          speaker: 'NPC',
          text: 'a',
          choices: [
            {
              id: 'x',
              label: 'x',
              conditions: [
                { type: 'HAS_ITEM', itemSlug: 'iron-ore', quantity: 1 },
                { type: 'QUEST_STATUS', questSlug: 'a-quest', status: 'ACTIVE' },
                { type: 'FLAG_EQUALS', flagKey: 'a-flag', value: 'true' },
              ],
              effects: [{ type: 'SET_FLAG', flagKey: 'b-flag', value: 'true' }],
              to: null,
            },
          ],
        },
      ],
    };
    const deps = dialogueDependencies(payload);
    expect(deps).toContainEqual({ type: 'ITEM', key: 'iron-ore' });
    expect(deps).toContainEqual({ type: 'QUEST', key: 'a-quest' });
    expect(deps).toContainEqual({ type: 'NARRATIVE_FLAG', key: 'a-flag' });
    expect(deps).toContainEqual({ type: 'NARRATIVE_FLAG', key: 'b-flag' });
  });
});
