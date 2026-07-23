import { describe, expect, it } from 'vitest';

import {
  DIALOGUES,
  LOCATIONS,
  NARRATIVE_FLAGS,
  NPC_DEFINITIONS,
  NPC_PLACEMENTS,
} from '../../../prisma/seed-data.mjs';

/**
 * Living-world seed integrity (Phase 26). These are pure-data invariants over
 * the authored seed — they need no database. They guarantee the shipped world
 * is representative (enough named NPCs and dialogue to feel alive) and that
 * every cross-reference the runtime relies on resolves: placements point at real
 * locations, an NPC's dialogue exists, and every dialogue graph is structurally
 * sound (entry present, targets resolve, declared flags only).
 */

const locationSlugs = new Set(LOCATIONS.map((l) => l.slug));
const npcKeys = new Set(NPC_DEFINITIONS.map((n) => n.key));
const dialogueKeys = new Set(DIALOGUES.map((d) => d.key));
const flagKeys = new Set(NARRATIVE_FLAGS.map((f) => f.key));

describe('living-world seed is representative', () => {
  it('ships a substantial cast of named NPCs', () => {
    expect(NPC_DEFINITIONS.length).toBeGreaterThanOrEqual(20);
  });

  it('ships a substantial body of authored dialogue', () => {
    expect(DIALOGUES.length).toBeGreaterThanOrEqual(12);
  });

  it('spreads NPCs across every region', () => {
    const regions = new Set(NPC_DEFINITIONS.map((n) => n.homeRegion));
    const worldRegions = new Set(LOCATIONS.map((l) => l.region));
    for (const region of worldRegions) expect(regions).toContain(region);
  });

  it('uses unique NPC and dialogue keys', () => {
    expect(npcKeys.size).toBe(NPC_DEFINITIONS.length);
    expect(dialogueKeys.size).toBe(DIALOGUES.length);
  });
});

describe('living-world seed references resolve', () => {
  it('places every NPC at a real location, and every NPC is placed', () => {
    const placed = new Set<string>();
    for (const p of NPC_PLACEMENTS) {
      expect(locationSlugs, `placement location ${p.locationSlug}`).toContain(p.locationSlug);
      expect(npcKeys, `placement npc ${p.npcKey}`).toContain(p.npcKey);
      expect(p.segments.length, `placement ${p.npcKey} segments`).toBeGreaterThan(0);
      placed.add(p.npcKey);
    }
    for (const n of NPC_DEFINITIONS) expect(placed, `NPC ${n.key} placed`).toContain(n.key);
  });

  it("resolves every NPC's dialogueKey to an authored dialogue", () => {
    for (const n of NPC_DEFINITIONS) {
      if (n.dialogueKey === null) continue;
      expect(dialogueKeys, `NPC ${n.key} dialogue`).toContain(n.dialogueKey);
    }
  });

  it('names a portrait asset for every NPC', () => {
    for (const n of NPC_DEFINITIONS) {
      expect(n.portraitAssetKey.length, `NPC ${n.key} portrait`).toBeGreaterThan(0);
    }
  });
});

describe('every seeded dialogue graph is sound', () => {
  it('has a present entry node and only resolving choice targets', () => {
    for (const d of DIALOGUES) {
      const ids = new Set(d.nodes.map((n) => n.id));
      expect(ids, `${d.key} entry`).toContain(d.entryNodeId);
      for (const node of d.nodes) {
        for (const choice of node.choices) {
          if (choice.to === null) continue;
          expect(ids, `${d.key} choice → ${choice.to}`).toContain(choice.to);
        }
      }
    }
  });

  it('reaches every node from the entry (no orphans)', () => {
    for (const d of DIALOGUES) {
      const byId = new Map(d.nodes.map((n) => [n.id, n]));
      const seen = new Set<string>();
      const stack = [d.entryNodeId];
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const choice of byId.get(id)?.choices ?? []) {
          if (choice.to !== null) stack.push(choice.to);
        }
      }
      for (const node of d.nodes)
        expect(seen, `${d.key} node ${node.id} reachable`).toContain(node.id);
    }
  });

  it('only references declared narrative flags', () => {
    for (const d of DIALOGUES) {
      for (const node of d.nodes) {
        for (const choice of node.choices) {
          for (const rule of [...choice.conditions, ...choice.effects]) {
            if (rule.type === 'SET_FLAG' || rule.type === 'FLAG_EQUALS') {
              expect(flagKeys, `${d.key} flag ${rule.flagKey}`).toContain(rule.flagKey);
            }
          }
        }
      }
    }
  });
});
