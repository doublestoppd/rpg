import type { ContentBundle } from '@rpg/shared';
import { describe, expect, it } from 'vitest';

import { validateBundle } from './content-validate.js';

/**
 * Living-world content validation (Phase 26, increment 2): NPCs and placements
 * publish through the same platform as every other content type, and a schedule
 * that strands an essential service must be rejected before publication.
 */

const location = {
  type: 'LOCATION' as const,
  key: 'crownfall-city',
  revision: 1,
  payload: {
    slug: 'crownfall-city',
    name: 'Crownfall City',
    region: 'crownfall',
    description: 'x',
    artworkKey: 'loc-crownfall',
    isSafe: true,
    isolated: true,
  },
};

const npc = (key: string, serviceType: string) => ({
  type: 'NPC' as const,
  key,
  revision: 1,
  payload: {
    key,
    name: key,
    pronouns: 'they/them',
    shortDescription: 's',
    longDescription: 'l',
    roles: ['MERCHANT'],
    tags: [],
    portraitAssetKey: `portrait-${key}`,
    sceneAssetKey: null,
    homeRegion: 'crownfall',
    serviceType,
    serviceRef: null,
    dialogueKey: null,
  },
});

const placement = (npcKey: string, segments: string[]) => ({
  type: 'NPC_PLACEMENT' as const,
  key: `${npcKey}@crownfall-city`,
  revision: 1,
  payload: {
    key: `${npcKey}@crownfall-city`,
    npcKey,
    locationSlug: 'crownfall-city',
    segments,
    priority: 1,
    visibility: 'PUBLIC',
  },
});

const bundle = (definitions: ContentBundle['definitions']): ContentBundle => ({
  formatVersion: 1,
  title: 'test',
  definitions,
});

describe('NPC content validation', () => {
  it('accepts an essential-service NPC that covers every world segment', () => {
    const result = validateBundle(
      bundle([location, npc('mira', 'SHOP'), placement('mira', ['DAWN', 'DAY', 'DUSK', 'NIGHT'])]),
    );
    expect(result.violations.filter((v) => v.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects a schedule that strands a required service in some segment', () => {
    const result = validateBundle(
      bundle([location, npc('mira', 'SHOP'), placement('mira', ['DAY'])]),
    );
    const stranded = result.violations.find((v) => v.code === 'STRANDED_SERVICE');
    expect(stranded, JSON.stringify(result.violations)).toBeDefined();
    expect(stranded!.message).toContain('DAWN');
    expect(result.ok).toBe(false);
  });

  it('accepts a stranded NON-essential service (ambient NPCs may keep hours)', () => {
    const result = validateBundle(
      bundle([location, npc('tomas', 'NONE'), placement('tomas', ['DAY'])]),
    );
    expect(result.violations.some((v) => v.code === 'STRANDED_SERVICE')).toBe(false);
  });

  it('covers a required service across segments with a replacement per segment', () => {
    const result = validateBundle(
      bundle([
        location,
        npc('day-clerk', 'SHOP'),
        npc('night-clerk', 'SHOP'),
        placement('day-clerk', ['DAWN', 'DAY']),
        placement('night-clerk', ['DUSK', 'NIGHT']),
      ]),
    );
    expect(result.violations.some((v) => v.code === 'STRANDED_SERVICE')).toBe(false);
    expect(result.ok).toBe(true);
  });

  it('rejects an NPC with no portrait asset key', () => {
    const noPortrait = npc('ghost', 'NONE');
    (noPortrait.payload as Record<string, unknown>)['portraitAssetKey'] = '';
    const result = validateBundle(bundle([location, noPortrait, placement('ghost', ['DAY'])]));
    expect(result.violations.some((v) => v.code === 'MISSING_ASSET')).toBe(true);
  });

  it('rejects a placement that references a missing NPC or location', () => {
    const result = validateBundle(bundle([placement('nobody', ['DAY'])]));
    expect(result.violations.some((v) => v.code === 'UNRESOLVED_REFERENCE')).toBe(true);
  });
});
