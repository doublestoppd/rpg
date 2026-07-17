import { type AbilityDefinition, combatConfig } from '../../config/combat.js';
import type { CombatRng } from '../../lib/combat-rng.js';

/**
 * Pure combat engine (Phase 12). Operates on plain in-memory state with a
 * deterministic PRNG; owns every rule — initiative, damage, elements, rows,
 * statuses, defend, flee — while the service owns persistence. All math is
 * fixed-point integer.
 */

export const GAUGE_MAX = 100_000;

export type CombatElement = 'FLAME' | 'FROST' | 'STORM' | 'STONE';
export type CombatStatusType =
  'POISON' | 'BLIND' | 'SILENCE' | 'SLOW' | 'HASTE' | 'GUARD' | 'STUN' | 'ARMOR_BREAK';

export interface EngineStatus {
  type: CombatStatusType;
  magnitude: number;
  remainingTurns: number;
}

export interface EnemyAiAction {
  kind: 'ATTACK' | 'PHYSICAL' | 'SPELL' | 'STATUS';
  name: string;
  weight: number;
  powerBps?: number | undefined;
  element?: CombatElement | undefined;
  status?: CombatStatusType | undefined;
  magnitude?: number | undefined;
  turns?: number | undefined;
  applies?:
    { status: CombatStatusType; magnitude: number; turns: number; chanceBps: number } | undefined;
}

export interface EngineCombatant {
  id: string;
  slot: number;
  kind: 'PLAYER' | 'ENEMY';
  name: string;
  row: 'FRONT' | 'BACK';
  ranged: boolean;
  /** Fixed-point initiative gauge: GAUGE_MAX = ready. */
  gauge: number;
  hp: number;
  mp: number;
  maxHp: number;
  maxMp: number;
  strength: number;
  agility: number;
  magic: number;
  defense: number;
  magicDefense: number;
  luck: number;
  affinities: Partial<Record<CombatElement, number>>;
  statuses: EngineStatus[];
  aiActions?: EnemyAiAction[];
}

export type EngineOutcome = 'ACTIVE' | 'VICTORY' | 'DEFEAT' | 'FLED';

export interface EngineState {
  combatants: EngineCombatant[];
  log: string[];
  fleeAttempts: number;
  fleeable: boolean;
  fleeModifierBps: number;
  outcome: EngineOutcome;
}

export type PlayerCommand =
  | { action: 'ATTACK'; targetId: string }
  | { action: 'ABILITY' | 'MAGIC'; ability: AbilityDefinition; targetId?: string }
  | { action: 'ITEM'; itemName: string; hpRestore: number; mpRestore: number }
  | { action: 'DEFEND' }
  | { action: 'FLEE' };

/** Rule violation surfaced to the API as a 400/409; consumes nothing. */
export class EngineRuleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineRuleError';
  }
}

export function getStatus(c: EngineCombatant, type: CombatStatusType): EngineStatus | undefined {
  return c.statuses.find((s) => s.type === type);
}

export function removeStatus(c: EngineCombatant, type: CombatStatusType): void {
  c.statuses = c.statuses.filter((s) => s.type !== type);
}

export function applyStatus(c: EngineCombatant, incoming: EngineStatus): void {
  const existing = getStatus(c, incoming.type);
  if (existing) {
    existing.magnitude = Math.max(existing.magnitude, incoming.magnitude);
    existing.remainingTurns = Math.max(existing.remainingTurns, incoming.remainingTurns);
  } else {
    c.statuses.push({ ...incoming });
  }
}

/** Initiative rate: max(1, agility), scaled by Haste/Slow, floor ≥ 1. */
export function effectiveRate(c: EngineCombatant): number {
  let rateBps = 10_000;
  if (getStatus(c, 'HASTE')) rateBps = combatConfig.hasteRateBps;
  if (getStatus(c, 'SLOW')) rateBps = combatConfig.slowRateBps;
  return Math.max(1, Math.floor((Math.max(1, c.agility) * rateBps) / 10_000));
}

/** Defense after Armor Break (reduction in bps). */
export function effectiveDefense(c: EngineCombatant): number {
  const broken = getStatus(c, 'ARMOR_BREAK');
  if (!broken) return c.defense;
  return Math.floor((c.defense * (10_000 - broken.magnitude)) / 10_000);
}

export function alive(state: EngineState): EngineCombatant[] {
  return state.combatants.filter((c) => c.hp > 0);
}

export function player(state: EngineState): EngineCombatant {
  const found = state.combatants.find((c) => c.kind === 'PLAYER');
  if (!found) throw new Error('combat engine: no player combatant');
  return found;
}

export function livingEnemies(state: EngineState): EngineCombatant[] {
  return state.combatants.filter((c) => c.kind === 'ENEMY' && c.hp > 0);
}

/**
 * Advances every living gauge by the minimum virtual time until someone is
 * ready; ties resolve by higher Agility, then higher Luck, then lower slot.
 */
export function isReady(c: EngineCombatant): boolean {
  return c.gauge >= GAUGE_MAX;
}

export function advanceToNextReady(state: EngineState): EngineCombatant {
  const living = alive(state);
  if (living.length === 0) throw new Error('combat engine: nobody alive to advance');
  let ready = living.filter(isReady);
  if (ready.length === 0) {
    const time = Math.min(
      ...living.map((c) => Math.ceil((GAUGE_MAX - c.gauge) / effectiveRate(c))),
    );
    for (const c of living) {
      c.gauge = Math.min(GAUGE_MAX, c.gauge + effectiveRate(c) * time);
    }
    ready = living.filter(isReady);
  }
  ready.sort((a, b) => b.agility - a.agility || b.luck - a.luck || a.slot - b.slot);
  return ready[0]!;
}

interface DamageOptions {
  powerBps: number;
  element?: CombatElement | undefined;
  rangedAttack: boolean;
  /** Magic never misses; physical rolls accuracy (reduced by Blind). */
  magical: boolean;
}

export interface DamageResult {
  hit: boolean;
  damage: number;
  immune: boolean;
  affinityBps: number;
}

/** One damage roll, fully fixed-point. Applies the result to the target. */
export function rollDamage(
  rng: CombatRng,
  attacker: EngineCombatant,
  target: EngineCombatant,
  opts: DamageOptions,
): DamageResult {
  if (!opts.magical) {
    const blind = getStatus(attacker, 'BLIND');
    const accuracy = Math.max(0, combatConfig.baseAccuracyBps - (blind?.magnitude ?? 0));
    if (!rng.chance(accuracy)) return { hit: false, damage: 0, immune: false, affinityBps: 10_000 };
  }

  let raw: number;
  if (opts.magical) {
    const offense =
      Math.floor((attacker.magic * opts.powerBps) / 10_000) + combatConfig.baseMagical;
    const mitigation = Math.floor((target.magicDefense * combatConfig.magicMitigationBps) / 10_000);
    raw = Math.max(1, offense - mitigation);
  } else {
    const offense =
      Math.floor((attacker.strength * opts.powerBps) / 10_000) + combatConfig.basePhysical;
    const mitigation = Math.floor(
      (effectiveDefense(target) * combatConfig.defenseMitigationBps) / 10_000,
    );
    raw = Math.max(1, offense - mitigation);
  }

  const affinityBps = opts.element ? (target.affinities[opts.element] ?? 10_000) : 10_000;
  if (affinityBps === 0) {
    return { hit: true, damage: 0, immune: true, affinityBps };
  }
  raw = Math.floor((raw * affinityBps) / 10_000);

  const variance = rng.nextInt(combatConfig.varianceMinBps, combatConfig.varianceMaxBps);
  let damage = Math.floor((raw * variance) / 10_000);

  const guard = getStatus(target, 'GUARD');
  if (guard) damage = Math.floor((damage * guard.magnitude) / 10_000);
  if (!opts.magical && target.row === 'BACK' && !opts.rangedAttack) {
    damage = Math.floor((damage * combatConfig.backRowMeleeBps) / 10_000);
  }
  damage = Math.max(1, damage);
  target.hp = Math.max(0, target.hp - damage);
  return { hit: true, damage, immune: false, affinityBps };
}

function affinityNote(result: DamageResult): string {
  if (result.immune) return ' It has no effect!';
  if (result.affinityBps > 10_000) return ' It strikes true — a sore spot!';
  if (result.affinityBps < 10_000) return ' It is partly shrugged off.';
  return '';
}

/**
 * Post-action processing for whoever just completed an action (including a
 * stun skip): Poison ticks first, then non-GUARD/STUN statuses lose a turn.
 * GUARD expires at the defender's next command phase; STUN consumes charges.
 */
export function processPostAction(state: EngineState, actor: EngineCombatant): void {
  const poison = getStatus(actor, 'POISON');
  if (poison && actor.hp > 0) {
    actor.hp = Math.max(0, actor.hp - poison.magnitude);
    state.log.push(`${actor.name} suffers ${poison.magnitude} poison damage.`);
    if (actor.hp === 0) state.log.push(`${actor.name} collapses!`);
  }
  for (const status of [...actor.statuses]) {
    if (status.type === 'GUARD' || status.type === 'STUN') continue;
    status.remainingTurns -= 1;
    if (status.remainingTurns <= 0) {
      removeStatus(actor, status.type);
      state.log.push(`${actor.name} recovers from ${statusLabel(status.type)}.`);
    }
  }
}

export function statusLabel(type: CombatStatusType): string {
  const labels: Record<CombatStatusType, string> = {
    POISON: 'Poison',
    BLIND: 'Blind',
    SILENCE: 'Silence',
    SLOW: 'Slow',
    HASTE: 'Haste',
    GUARD: 'Guard',
    STUN: 'Stun',
    ARMOR_BREAK: 'Armor Break',
  };
  return labels[type];
}

export function checkOutcome(state: EngineState): void {
  if (state.outcome !== 'ACTIVE') return;
  if (player(state).hp <= 0) {
    state.outcome = 'DEFEAT';
    state.log.push('You fall — darkness takes the field.');
    return;
  }
  if (livingEnemies(state).length === 0) {
    state.outcome = 'VICTORY';
    state.log.push('Victory! The field is yours.');
  }
}

function enemyAct(state: EngineState, rng: CombatRng, enemy: EngineCombatant): void {
  const target = player(state);
  const fallback: EnemyAiAction = { kind: 'ATTACK', name: 'Strike', weight: 1 };
  const actions: EnemyAiAction[] = enemy.aiActions ?? [fallback];
  const total = actions.reduce((sum, a) => sum + a.weight, 0);
  let roll = rng.nextInt(1, total);
  let chosen: EnemyAiAction = actions[0]!;
  for (const action of actions) {
    roll -= action.weight;
    if (roll <= 0) {
      chosen = action;
      break;
    }
  }
  // A silenced enemy cannot cast; it falls back to a basic attack.
  if (chosen.kind === 'SPELL' && getStatus(enemy, 'SILENCE')) {
    state.log.push(`${enemy.name} is silenced and lashes out instead.`);
    chosen = fallback;
  }

  if (chosen.kind === 'STATUS') {
    applyStatus(target, {
      type: chosen.status!,
      magnitude: chosen.magnitude!,
      remainingTurns: chosen.turns!,
    });
    state.log.push(
      `${enemy.name} uses ${chosen.name} — you are afflicted by ${statusLabel(chosen.status!)}!`,
    );
    return;
  }

  const magical = chosen.kind === 'SPELL';
  const result = rollDamage(rng, enemy, target, {
    powerBps: chosen.powerBps ?? 10_000,
    element: chosen.element,
    rangedAttack: enemy.ranged,
    magical,
  });
  if (!result.hit) {
    state.log.push(`${enemy.name} uses ${chosen.name} — it misses!`);
    return;
  }
  state.log.push(
    `${enemy.name} uses ${chosen.name} for ${result.damage} damage.${affinityNote(result)}`,
  );
  if (chosen.applies && result.damage > 0 && rng.chance(chosen.applies.chanceBps)) {
    applyStatus(target, {
      type: chosen.applies.status,
      magnitude: chosen.applies.magnitude,
      remainingTurns: chosen.applies.turns,
    });
    state.log.push(`You are afflicted by ${statusLabel(chosen.applies.status)}!`);
  }
  if (target.hp === 0) state.log.push('You crumple to the ground!');
}

/**
 * Advances turns until the player is ready for a command (pausing there) or
 * the combat ends. Stunned combatants skip their action, reset to 0, consume
 * one stun charge, and still take post-action ticks.
 */
export function runUntilPlayerCommand(state: EngineState, rng: CombatRng): void {
  while (state.outcome === 'ACTIVE') {
    const next = advanceToNextReady(state);
    const stun = getStatus(next, 'STUN');
    if (stun) {
      next.gauge = 0;
      stun.magnitude -= 1;
      if (stun.magnitude <= 0) removeStatus(next, 'STUN');
      state.log.push(`${next.name} is stunned and cannot act!`);
      processPostAction(state, next);
      checkOutcome(state);
      continue;
    }
    // Guard lasts until its holder's next turn begins.
    if (getStatus(next, 'GUARD')) removeStatus(next, 'GUARD');
    if (next.kind === 'PLAYER') return; // pause for command at full gauge
    enemyAct(state, rng, next);
    next.gauge = 0;
    processPostAction(state, next);
    checkOutcome(state);
  }
}

function resolveAbilityDamage(
  state: EngineState,
  rng: CombatRng,
  attacker: EngineCombatant,
  ability: AbilityDefinition,
  targets: EngineCombatant[],
): void {
  for (const target of targets) {
    let landed = false;
    for (let i = 0; i < ability.hits && target.hp > 0; i++) {
      const result = rollDamage(rng, attacker, target, {
        powerBps: ability.powerBps,
        element: ability.element,
        rangedAttack: ability.ranged,
        magical: ability.kind === 'MAGICAL',
      });
      if (!result.hit) {
        state.log.push(`${attacker.name} uses ${ability.name} — it misses ${target.name}!`);
        continue;
      }
      landed = landed || result.damage > 0;
      state.log.push(
        `${attacker.name} uses ${ability.name} on ${target.name} for ${result.damage} damage.` +
          affinityNote(result),
      );
      if (target.hp === 0) state.log.push(`${target.name} is defeated!`);
    }
    if (ability.applies && landed && target.hp > 0 && rng.chance(ability.applies.chanceBps)) {
      applyStatus(target, {
        type: ability.applies.status,
        magnitude: ability.applies.magnitude,
        remainingTurns: ability.applies.turns,
      });
      state.log.push(`${target.name} is afflicted by ${statusLabel(ability.applies.status)}!`);
    }
  }
}

/**
 * Resolves one player command. The caller has already validated ownership,
 * item stock, and ability lookup; this enforces in-combat rules (turn ready,
 * MP, Silence, flee rules, valid living target) and mutates state. Throws
 * EngineRuleError without mutating on rule violations.
 */
export function resolvePlayerCommand(
  state: EngineState,
  rng: CombatRng,
  command: PlayerCommand,
): void {
  const self = player(state);
  if (!isReady(self)) {
    throw new EngineRuleError('NOT_READY', 'It is not your turn.');
  }

  const findTarget = (targetId: string | undefined): EngineCombatant => {
    const target = livingEnemies(state).find((c) => c.id === targetId);
    if (!target) throw new EngineRuleError('INVALID_TARGET', 'That target is not standing.');
    return target;
  };

  switch (command.action) {
    case 'ATTACK': {
      const target = findTarget(command.targetId);
      const result = rollDamage(rng, self, target, {
        powerBps: 10_000,
        rangedAttack: self.ranged,
        magical: false,
      });
      state.log.push(
        result.hit
          ? `${self.name} attacks ${target.name} for ${result.damage} damage.${affinityNote(result)}`
          : `${self.name} attacks ${target.name} — and misses!`,
      );
      if (result.hit && target.hp === 0) state.log.push(`${target.name} is defeated!`);
      break;
    }
    case 'ABILITY':
    case 'MAGIC': {
      const ability = command.ability;
      if (command.action === 'MAGIC' && getStatus(self, 'SILENCE')) {
        throw new EngineRuleError('SILENCED', 'You are silenced and cannot cast.');
      }
      if (self.mp < ability.mpCost) {
        throw new EngineRuleError('INSUFFICIENT_MP', 'Not enough MP.');
      }
      self.mp -= ability.mpCost;
      if (ability.targeting === 'SELF') {
        if (ability.applies && rng.chance(ability.applies.chanceBps)) {
          applyStatus(self, {
            type: ability.applies.status,
            magnitude: ability.applies.magnitude,
            remainingTurns: ability.applies.turns,
          });
          state.log.push(
            `${self.name} uses ${ability.name} — ${statusLabel(ability.applies.status)}!`,
          );
        }
      } else if (ability.targeting === 'ALL_ENEMIES') {
        resolveAbilityDamage(state, rng, self, ability, livingEnemies(state));
      } else {
        const target = findTarget(command.targetId);
        if (ability.powerBps === 0 && ability.applies) {
          // Pure support effect on an enemy always rolls its chance.
          if (rng.chance(ability.applies.chanceBps)) {
            applyStatus(target, {
              type: ability.applies.status,
              magnitude: ability.applies.magnitude,
              remainingTurns: ability.applies.turns,
            });
            state.log.push(
              `${self.name} uses ${ability.name} — ${target.name} is afflicted by ` +
                `${statusLabel(ability.applies.status)}!`,
            );
          } else {
            state.log.push(`${self.name} uses ${ability.name} — but it fails.`);
          }
        } else {
          resolveAbilityDamage(state, rng, self, ability, [target]);
        }
      }
      break;
    }
    case 'ITEM': {
      const healedHp = Math.min(self.maxHp - self.hp, command.hpRestore);
      const healedMp = Math.min(self.maxMp - self.mp, command.mpRestore);
      self.hp += healedHp;
      self.mp += healedMp;
      const parts = [];
      if (healedHp > 0) parts.push(`${healedHp} HP`);
      if (healedMp > 0) parts.push(`${healedMp} MP`);
      state.log.push(
        `${self.name} uses ${command.itemName}` +
          (parts.length > 0 ? ` and recovers ${parts.join(' and ')}.` : ' — nothing happens.'),
      );
      break;
    }
    case 'DEFEND': {
      // Defend activates immediately and holds until the next command phase.
      applyStatus(self, {
        type: 'GUARD',
        magnitude: combatConfig.guardReductionBps,
        remainingTurns: 1,
      });
      state.log.push(`${self.name} braces behind a guard.`);
      break;
    }
    case 'FLEE': {
      if (!state.fleeable) {
        throw new EngineRuleError('NOT_FLEEABLE', 'There is no escaping this battle.');
      }
      const enemies = livingEnemies(state);
      const avgEnemyAgility = Math.floor(
        enemies.reduce((sum, e) => sum + e.agility, 0) / enemies.length,
      );
      const chance = Math.min(
        combatConfig.fleeMaxBps,
        Math.max(
          combatConfig.fleeMinBps,
          combatConfig.fleeBaseBps +
            (self.agility - avgEnemyAgility) * combatConfig.fleePerAgilityPointBps +
            state.fleeModifierBps +
            state.fleeAttempts * combatConfig.fleeRetryBonusBps,
        ),
      );
      if (rng.chance(chance)) {
        state.outcome = 'FLED';
        state.log.push(`${self.name} slips away from the fight!`);
      } else {
        // A failed flee still consumes the action.
        state.fleeAttempts += 1;
        state.log.push(`${self.name} tries to flee — but cannot break away!`);
      }
      break;
    }
  }

  self.gauge = 0;
  processPostAction(state, self);
  checkOutcome(state);
}
