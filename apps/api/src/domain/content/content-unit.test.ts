import type { ContentBundle, ContentDefinitionEntry } from '@rpg/shared';
import { describe, expect, it } from 'vitest';

import { canonicalize, checksumOf, stableStringify } from './canonical.js';
import { buildDependencyGraph, dependentsOf, reachableLocations } from './content-graph.js';
import { validateBundle } from './content-validate.js';

// --- fixtures --------------------------------------------------------------

function location(slug: string, over: Record<string, unknown> = {}): ContentDefinitionEntry {
  return {
    type: 'LOCATION',
    key: slug,
    revision: 1,
    payload: {
      slug,
      name: slug,
      region: 'Heartlands',
      description: '',
      artworkKey: `art/${slug}`,
      isSafe: true,
      ...over,
    },
  };
}

function route(from: string, to: string): ContentDefinitionEntry {
  return {
    type: 'TRAVEL_ROUTE',
    key: `${from}->${to}`,
    revision: 1,
    payload: { fromSlug: from, toSlug: to, travelSeconds: 10, goldCost: '5' },
  };
}

function item(slug: string, over: Record<string, unknown> = {}): ContentDefinitionEntry {
  return {
    type: 'ITEM',
    key: slug,
    revision: 1,
    payload: {
      slug,
      name: slug,
      description: '',
      category: 'RESOURCE',
      stackable: true,
      maxStackQuantity: 99,
      equipmentSlot: null,
      levelRequirement: 1,
      bonusStrength: 0,
      bonusAgility: 0,
      bonusMagic: 0,
      bonusDefense: 0,
      bonusMagicDefense: 0,
      bonusLuck: 0,
      bonusMaxHp: 0,
      bonusMaxMp: 0,
      hpRestore: 0,
      mpRestore: 0,
      usableInCombat: false,
      baseValue: '10',
      ...over,
    },
  };
}

function bundle(...definitions: ContentDefinitionEntry[]): ContentBundle {
  return {
    formatVersion: 1,
    title: 'test',
    definitions: [location('crownfall-city'), ...definitions],
  };
}

// --- canonicalization ------------------------------------------------------

describe('canonicalize', () => {
  it('sorts object keys recursively and preserves array order', () => {
    const value = { b: 1, a: { d: 4, c: 3 }, list: [3, 1, 2] };
    expect(stableStringify(value)).toBe('{"a":{"c":3,"d":4},"b":1,"list":[3,1,2]}');
  });

  it('serializes BigInt as a decimal string and drops undefined', () => {
    expect(canonicalize({ gold: 10n, skip: undefined, keep: 1 })).toEqual({ gold: '10', keep: 1 });
  });

  it('produces a checksum independent of source key order', () => {
    expect(checksumOf({ a: 1, b: 2 })).toBe(checksumOf({ b: 2, a: 1 }));
    expect(checksumOf({ a: 1 })).not.toBe(checksumOf({ a: 2 }));
  });
});

// --- dependency graph ------------------------------------------------------

describe('dependency graph', () => {
  it('emits an edge for every declared stable-key reference', () => {
    const edges = buildDependencyGraph(
      bundle(location('meadowbrook'), route('crownfall-city', 'meadowbrook')),
    );
    const routeEdges = edges.filter((e) => e.fromType === 'TRAVEL_ROUTE');
    expect(routeEdges).toEqual([
      {
        fromType: 'TRAVEL_ROUTE',
        fromKey: 'crownfall-city->meadowbrook',
        toType: 'LOCATION',
        toKey: 'crownfall-city',
      },
      {
        fromType: 'TRAVEL_ROUTE',
        fromKey: 'crownfall-city->meadowbrook',
        toType: 'LOCATION',
        toKey: 'meadowbrook',
      },
    ]);
  });

  it('answers "where used" via dependentsOf', () => {
    const edges = buildDependencyGraph(
      bundle(location('meadowbrook'), route('crownfall-city', 'meadowbrook')),
    );
    expect(dependentsOf(edges, 'LOCATION', 'meadowbrook')).toContainEqual({
      type: 'TRAVEL_ROUTE',
      key: 'crownfall-city->meadowbrook',
    });
  });

  it('treats travel routes as undirected for connectivity', () => {
    const b = bundle(
      location('meadowbrook'),
      location('far'),
      route('crownfall-city', 'meadowbrook'),
    );
    const reachable = reachableLocations(b, 'crownfall-city');
    expect(reachable.has('meadowbrook')).toBe(true);
    expect(reachable.has('far')).toBe(false);
  });
});

// --- validation rules ------------------------------------------------------

function codes(b: ContentBundle): string[] {
  return validateBundle(b)
    .violations.filter((v) => v.severity === 'error')
    .map((v) => v.code);
}

describe('validateBundle', () => {
  it('accepts a well-formed bundle', () => {
    const b = bundle(location('meadowbrook'), route('crownfall-city', 'meadowbrook'), item('herb'));
    const result = validateBundle(b);
    expect(result.ok).toBe(true);
    expect(result.violations.filter((v) => v.severity === 'error')).toEqual([]);
  });

  it('rejects duplicate stable keys', () => {
    const b = bundle(item('herb'), item('herb'));
    expect(codes(b)).toContain('DUPLICATE_KEY');
  });

  it('rejects a structurally invalid revision', () => {
    const b = bundle(item('herb', { maxStackQuantity: 0 }));
    expect(codes(b)).toContain('INVALID_REVISION');
  });

  it('rejects a payload whose slug no longer matches its stable key', () => {
    const b = bundle({ ...item('herb'), key: 'renamed' });
    expect(codes(b)).toContain('CHANGED_KEY');
  });

  it('rejects a route to an unpublished location', () => {
    const b = bundle(route('crownfall-city', 'nowhere'));
    expect(codes(b)).toContain('UNRESOLVED_REFERENCE');
  });

  it('rejects a location missing its artwork key', () => {
    const b = bundle(
      location('meadowbrook', { artworkKey: '' }),
      route('crownfall-city', 'meadowbrook'),
    );
    expect(codes(b)).toContain('MISSING_ASSET');
  });

  it('rejects a disconnected world subgraph unless it is marked isolated', () => {
    expect(codes(bundle(location('island')))).toContain('DISCONNECTED_LOCATION');
    // Opting out with isolated:true clears the error.
    expect(codes(bundle(location('island', { isolated: true })))).not.toContain(
      'DISCONNECTED_LOCATION',
    );
  });

  it('rejects a gathering reward table with invalid weights or quantities', () => {
    const gather: ContentDefinitionEntry = {
      type: 'GATHERING_ACTION',
      key: 'dig',
      revision: 1,
      payload: {
        slug: 'dig',
        name: 'Dig',
        description: '',
        skill: 'MINING',
        locationSlug: 'crownfall-city',
        levelRequirement: 1,
        staminaCost: 1,
        durationSeconds: 5,
        xpReward: 1,
        rewardTable: { entries: [{ itemSlug: 'ore', weight: 0, minQuantity: 2, maxQuantity: 1 }] },
        sortOrder: 0,
      },
    };
    expect(codes(bundle(item('ore'), gather))).toContain('INVALID_REWARD_TABLE');
  });

  it('rejects an enemy drop table with an out-of-range chance', () => {
    const enemy: ContentDefinitionEntry = {
      type: 'ENEMY',
      key: 'slime',
      revision: 1,
      payload: {
        slug: 'slime',
        name: 'Slime',
        description: '',
        level: 1,
        maxHp: 10,
        maxMp: 0,
        strength: 1,
        agility: 1,
        magic: 1,
        defense: 1,
        magicDefense: 1,
        luck: 1,
        ranged: false,
        affinities: {},
        aiConfig: {},
        rewardConfig: {
          drops: [{ itemSlug: 'goo', chanceBps: 99999, minQuantity: 1, maxQuantity: 1 }],
        },
      },
    };
    expect(codes(bundle(item('goo'), enemy))).toContain('INVALID_DROP_TABLE');
  });

  it('rejects a shop that permits guaranteed arbitrage and an impossible restock pool', () => {
    const shop = (over: Record<string, unknown>): ContentDefinitionEntry => ({
      type: 'NPC_SHOP',
      key: 'store',
      revision: 1,
      payload: {
        slug: 'store',
        name: 'Store',
        description: '',
        locationSlug: 'crownfall-city',
        markupBps: 11000,
        sellbackBps: 5000,
        poolConfig: {
          restockSlots: 2,
          pool: [
            { itemSlug: 'herb', weight: 1, minQuantity: 1, maxQuantity: 3, perCharacterLimit: 5 },
          ],
        },
        restockIntervalSeconds: 60,
        restockJitterSeconds: 0,
        ...over,
      },
    });
    // sellback >= markup is a guaranteed arbitrage loop.
    expect(codes(bundle(item('herb'), shop({ sellbackBps: 12000 })))).toContain('ARBITRAGE_LOOP');
    // An empty pool cannot restock.
    expect(
      codes(bundle(item('herb'), shop({ poolConfig: { restockSlots: 0, pool: [] } }))),
    ).toContain('IMPOSSIBLE_POOL');
  });

  it('rejects a collection referencing a non-collectible item', () => {
    const collection: ContentDefinitionEntry = {
      type: 'COLLECTION',
      key: 'relics',
      revision: 1,
      payload: {
        slug: 'relics',
        name: 'Relics',
        description: '',
        locationSlug: 'crownfall-city',
        sortOrder: 0,
        entries: [{ itemSlug: 'herb', curatorNote: '', sortOrder: 0 }],
      },
    };
    // herb is a RESOURCE, not COLLECTIBLE.
    expect(codes(bundle(item('herb'), collection))).toContain('NONCOLLECTIBLE_ENTRY');
  });

  it('rejects a quest objective the engine does not understand', () => {
    const quest: ContentDefinitionEntry = {
      type: 'QUEST',
      key: 'q1',
      revision: 1,
      payload: {
        slug: 'q1',
        name: 'Quest',
        description: '',
        rewardXp: 0,
        rewardGold: '0',
        rewardItems: [],
        sortOrder: 0,
        objectives: [
          {
            sortOrder: 0,
            type: 'DO_A_BACKFLIP',
            targetSlug: 'crownfall-city',
            requiredCount: 1,
            description: '',
          },
        ],
      },
    };
    expect(codes(bundle(quest))).toContain('INVALID_OBJECTIVE');
  });

  it('warns (but does not fail) on a bundle with no locations', () => {
    const result = validateBundle({ formatVersion: 1, title: 'empty', definitions: [] });
    expect(result.ok).toBe(true);
    expect(result.violations.map((v) => v.code)).toContain('EMPTY_WORLD');
  });
});
