import type { EnemyAiAction, EngineCombatant } from '../domain/combat/combat-engine.js';

/**
 * Summonable allies (party combat). A consumable item, when used in battle,
 * summons the ally its slug maps to here; the ally then fights automatically on
 * the player's side. Allies are fixed-stat templates (they do not scale with
 * the summoner) and are defined as data, mirroring how enemies are authored.
 */

export interface AllyTemplate {
  /** Display name of the summoned combatant. */
  name: string;
  row: 'FRONT' | 'BACK';
  ranged: boolean;
  maxHp: number;
  maxMp: number;
  strength: number;
  agility: number;
  magic: number;
  defense: number;
  magicDefense: number;
  luck: number;
  aiActions: EnemyAiAction[];
}

/** Item slug → the ally that item summons. */
export const ALLY_SUMMONS: Record<string, AllyTemplate> = {
  'spirit-wolf-totem': {
    name: 'Spirit Wolf',
    row: 'FRONT',
    ranged: false,
    maxHp: 42,
    maxMp: 0,
    strength: 14,
    agility: 18,
    magic: 4,
    defense: 6,
    magicDefense: 4,
    luck: 8,
    aiActions: [
      { kind: 'ATTACK', name: 'Bite', weight: 3 },
      { kind: 'PHYSICAL', name: 'Rend', weight: 1, powerBps: 15_000 },
    ],
  },
  'stone-sentinel-idol': {
    name: 'Stone Sentinel',
    row: 'FRONT',
    ranged: false,
    maxHp: 95,
    maxMp: 0,
    strength: 12,
    agility: 6,
    magic: 2,
    defense: 18,
    magicDefense: 10,
    luck: 4,
    aiActions: [
      { kind: 'ATTACK', name: 'Slam', weight: 3 },
      {
        kind: 'STATUS',
        name: 'Stonebind',
        weight: 1,
        status: 'SLOW',
        magnitude: 1,
        turns: 2,
      },
    ],
  },
};

export function allyTemplateForItem(slug: string): AllyTemplate | undefined {
  return ALLY_SUMMONS[slug];
}

/**
 * Builds a fresh, battle-ready ally combatant from a template. The caller
 * supplies the persistent id and a unique slot; the ally starts at full HP with
 * an empty gauge (it charges before its first turn) and no statuses.
 */
export function buildAllyCombatant(
  template: AllyTemplate,
  id: string,
  slot: number,
): EngineCombatant {
  return {
    id,
    slot,
    kind: 'ALLY',
    name: template.name,
    row: template.row,
    ranged: template.ranged,
    gauge: 0,
    hp: template.maxHp,
    mp: template.maxMp,
    maxHp: template.maxHp,
    maxMp: template.maxMp,
    strength: template.strength,
    agility: template.agility,
    magic: template.magic,
    defense: template.defense,
    magicDefense: template.magicDefense,
    luck: template.luck,
    affinities: {},
    statuses: [],
    aiActions: template.aiActions,
  };
}
