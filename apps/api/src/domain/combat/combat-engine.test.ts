import { describe, expect, it } from 'vitest';

import { CLASS_ABILITIES, combatConfig, findAbility } from '../../config/combat.js';
import { type CombatRng, createCombatRng } from '../../lib/combat-rng.js';
import {
  advanceToNextReady,
  applyStatus,
  effectiveRate,
  type EngineCombatant,
  EngineRuleError,
  type EngineState,
  GAUGE_MAX,
  getStatus,
  resolvePlayerCommand,
  rollDamage,
  runUntilPlayerCommand,
} from './combat-engine.js';

/** Scriptable deterministic RNG that records the chances it was asked for. */
function rigRng(opts: { ints?: number[]; chances?: boolean[] } = {}) {
  const ints = [...(opts.ints ?? [])];
  const chances = [...(opts.chances ?? [])];
  const chanceCalls: number[] = [];
  const rng: CombatRng & { chanceCalls: number[] } = {
    nextInt: (min: number) => (ints.length > 0 ? ints.shift()! : min),
    chance: (bps: number) => {
      chanceCalls.push(bps);
      return chances.length > 0 ? chances.shift()! : true;
    },
    get counter() {
      return 0;
    },
    chanceCalls,
  };
  return rng;
}

let nextId = 0;
function fighter(partial: Partial<EngineCombatant> = {}): EngineCombatant {
  nextId += 1;
  return {
    id: `c-${nextId}`,
    slot: nextId,
    kind: 'ENEMY',
    name: `Fighter ${nextId}`,
    row: 'FRONT',
    ranged: false,
    gauge: 0,
    hp: 50,
    mp: 20,
    maxHp: 50,
    maxMp: 20,
    strength: 10,
    agility: 10,
    magic: 10,
    defense: 8,
    magicDefense: 8,
    luck: 5,
    affinities: {},
    statuses: [],
    ...partial,
  };
}

function makeState(combatants: EngineCombatant[], partial: Partial<EngineState> = {}): EngineState {
  return {
    combatants,
    log: [],
    fleeAttempts: 0,
    fleeable: true,
    fleeModifierBps: 0,
    outcome: 'ACTIVE',
    ...partial,
  };
}

describe('initiative gauge', () => {
  it('advances all gauges by the minimum virtual time; fastest becomes ready', () => {
    const fast = fighter({ kind: 'PLAYER', agility: 10, slot: 0 });
    const slow = fighter({ agility: 5, slot: 1 });
    const state = makeState([fast, slow]);
    const next = advanceToNextReady(state);
    expect(next).toBe(fast);
    expect(fast.gauge).toBe(GAUGE_MAX);
    expect(slow.gauge).toBe(50_000); // advanced by the same virtual time
  });

  it('rate is max(1, agility): zero agility still fills the gauge', () => {
    expect(effectiveRate(fighter({ agility: 0 }))).toBe(1);
  });

  it('breaks ready ties by higher Agility, then higher Luck, then stable slot', () => {
    const a = fighter({ agility: 10, luck: 5, slot: 3 });
    const b = fighter({ agility: 12, luck: 1, slot: 4 });
    expect(advanceToNextReady(makeState([a, b]))).toBe(b); // agility first

    const c = fighter({ agility: 10, luck: 9, slot: 6 });
    const d = fighter({ agility: 10, luck: 2, slot: 5 });
    expect(advanceToNextReady(makeState([c, d]))).toBe(c); // luck second

    const e = fighter({ agility: 10, luck: 5, slot: 8 });
    const f = fighter({ agility: 10, luck: 5, slot: 7 });
    expect(advanceToNextReady(makeState([e, f]))).toBe(f); // lower slot last
  });

  it('Haste and Slow scale the initiative rate', () => {
    const hasted = fighter({ agility: 10 });
    applyStatus(hasted, { type: 'HASTE', magnitude: 0, remainingTurns: 2 });
    expect(effectiveRate(hasted)).toBe(15);
    const slowed = fighter({ agility: 10 });
    applyStatus(slowed, { type: 'SLOW', magnitude: 0, remainingTurns: 2 });
    expect(effectiveRate(slowed)).toBe(5);
  });
});

describe('physical damage', () => {
  // str 10 power 10000 base 2 → offense 12; def 8 → mitigation 4; raw 8.
  it('applies the fixed-point formula with secure variance', () => {
    const attacker = fighter({ strength: 10 });
    const target = fighter({ defense: 8, hp: 50 });
    const result = rollDamage(rigRng({ ints: [10_000] }), attacker, target, {
      powerBps: 10_000,
      rangedAttack: false,
      magical: false,
    });
    expect(result).toMatchObject({ hit: true, damage: 8 });
    expect(target.hp).toBe(42);
  });

  it('variance floors at 90%', () => {
    const attacker = fighter({ strength: 10 });
    const target = fighter({ defense: 8, hp: 50 });
    const result = rollDamage(rigRng({ ints: [9000] }), attacker, target, {
      powerBps: 10_000,
      rangedAttack: false,
      magical: false,
    });
    expect(result.damage).toBe(7); // floor(8 * 0.9)
  });

  it('a miss deals nothing and rolls accuracy against Blind', () => {
    const attacker = fighter({ strength: 10 });
    applyStatus(attacker, { type: 'BLIND', magnitude: 3500, remainingTurns: 3 });
    const target = fighter({ hp: 50 });
    const rng = rigRng({ chances: [false] });
    const result = rollDamage(rng, attacker, target, {
      powerBps: 10_000,
      rangedAttack: false,
      magical: false,
    });
    expect(result.hit).toBe(false);
    expect(target.hp).toBe(50);
    expect(rng.chanceCalls[0]).toBe(combatConfig.baseAccuracyBps - 3500);
  });

  it('Armor Break lowers effective defense', () => {
    const attacker = fighter({ strength: 10 });
    const target = fighter({ defense: 8, hp: 50 });
    applyStatus(target, { type: 'ARMOR_BREAK', magnitude: 3000, remainingTurns: 3 });
    const result = rollDamage(rigRng({ ints: [10_000] }), attacker, target, {
      powerBps: 10_000,
      rangedAttack: false,
      magical: false,
    });
    // def 8 × 0.7 = 5 → mitigation 2 → raw 10
    expect(result.damage).toBe(10);
  });

  it('Guard multiplies damage down by its magnitude', () => {
    const attacker = fighter({ strength: 10 });
    const target = fighter({ defense: 8, hp: 50 });
    applyStatus(target, { type: 'GUARD', magnitude: 5000, remainingTurns: 1 });
    const result = rollDamage(rigRng({ ints: [10_000] }), attacker, target, {
      powerBps: 10_000,
      rangedAttack: false,
      magical: false,
    });
    expect(result.damage).toBe(4); // floor(8 × 0.5)
  });
});

describe('rows', () => {
  it('reduces melee damage against the back row', () => {
    const attacker = fighter({ strength: 10 });
    const backRow = fighter({ defense: 8, row: 'BACK', hp: 50 });
    const result = rollDamage(rigRng({ ints: [10_000] }), attacker, backRow, {
      powerBps: 10_000,
      rangedAttack: false,
      magical: false,
    });
    expect(result.damage).toBe(4); // floor(8 × 0.6)
  });

  it('ranged attacks ignore the back-row penalty', () => {
    const attacker = fighter({ strength: 10 });
    const backRow = fighter({ defense: 8, row: 'BACK', hp: 50 });
    const result = rollDamage(rigRng({ ints: [10_000] }), attacker, backRow, {
      powerBps: 10_000,
      rangedAttack: true,
      magical: false,
    });
    expect(result.damage).toBe(8);
  });

  it('magic ignores rows entirely', () => {
    const attacker = fighter({ magic: 10 });
    const backRow = fighter({ magicDefense: 8, row: 'BACK', hp: 50 });
    const result = rollDamage(rigRng({ ints: [10_000] }), attacker, backRow, {
      powerBps: 10_000,
      rangedAttack: false,
      magical: true,
    });
    expect(result.damage).toBe(8); // same formula, no row penalty
  });
});

describe('elements', () => {
  // magic 10 power 15000 → offense 17; mdef 8 → mitigation 4; raw 13.
  const cast = (affinities: EngineCombatant['affinities']) => {
    const attacker = fighter({ magic: 10 });
    const target = fighter({ magicDefense: 8, hp: 100, affinities });
    const result = rollDamage(rigRng({ ints: [10_000] }), attacker, target, {
      powerBps: 15_000,
      element: 'FLAME',
      rangedAttack: false,
      magical: true,
    });
    return { result, target };
  };

  it('weak 1.5× / neutral 1.0× / resistant 0.5× / immune 0', () => {
    expect(cast({ FLAME: 15_000 }).result.damage).toBe(19); // floor(13 × 1.5)
    expect(cast({ FLAME: 10_000 }).result.damage).toBe(13);
    expect(cast({}).result.damage).toBe(13); // unlisted = neutral
    expect(cast({ FLAME: 5000 }).result.damage).toBe(6); // floor(13 × 0.5)
    const immune = cast({ FLAME: 0 });
    expect(immune.result.immune).toBe(true);
    expect(immune.result.damage).toBe(0);
    expect(immune.target.hp).toBe(100); // untouched
  });
});

describe('status timing', () => {
  it('Poison ticks after the affected combatant completes an action', () => {
    const self = fighter({ kind: 'PLAYER', gauge: GAUGE_MAX, hp: 50 });
    applyStatus(self, { type: 'POISON', magnitude: 3, remainingTurns: 2 });
    const enemy = fighter({ agility: 1, hp: 50 });
    const state = makeState([self, enemy]);
    resolvePlayerCommand(state, rigRng(), { action: 'DEFEND' });
    expect(self.hp).toBe(47); // ticked after the action
    expect(getStatus(self, 'POISON')?.remainingTurns).toBe(1);
  });

  it('Stun skips the action, resets the gauge, consumes one charge, and still ticks poison', () => {
    const self = fighter({ kind: 'PLAYER', agility: 5, slot: 0 });
    const stunned = fighter({ agility: 20, slot: 1, hp: 40 });
    applyStatus(stunned, { type: 'STUN', magnitude: 1, remainingTurns: 1 });
    applyStatus(stunned, { type: 'POISON', magnitude: 4, remainingTurns: 2 });
    const state = makeState([self, stunned]);
    runUntilPlayerCommand(state, rigRng({ chances: [false, false, false, false] }));
    // The faster enemy reached 100 first but was stunned: no attack landed.
    expect(state.log.some((line) => line.includes('stunned'))).toBe(true);
    expect(getStatus(stunned, 'STUN')).toBeUndefined(); // charge consumed
    expect(stunned.gauge).toBeLessThan(GAUGE_MAX); // reset to 0 then re-advanced
    // Poison ticked after the stun skip AND after the enemy's next real
    // action (both post-action phases), then expired: 40 - 4 - 4.
    expect(stunned.hp).toBe(32);
    expect(getStatus(stunned, 'POISON')).toBeUndefined();
  });

  it('Silence blocks Magic commands without consuming anything', () => {
    const self = fighter({ kind: 'PLAYER', gauge: GAUGE_MAX, mp: 20 });
    applyStatus(self, { type: 'SILENCE', magnitude: 1, remainingTurns: 2 });
    const enemy = fighter({ hp: 50 });
    const state = makeState([self, enemy]);
    const ability = findAbility('arcanist', 'flame-spark')!;
    expect(() =>
      resolvePlayerCommand(state, rigRng(), { action: 'MAGIC', ability, targetId: enemy.id }),
    ).toThrow(EngineRuleError);
    expect(self.mp).toBe(20);
    expect(self.gauge).toBe(GAUGE_MAX); // turn not consumed
    expect(enemy.hp).toBe(50);
  });

  it('Defend guards immediately and expires when the next command phase begins', () => {
    const self = fighter({ kind: 'PLAYER', agility: 10, slot: 0, hp: 50, defense: 8 });
    // Fast enough to act exactly once before the player's next command.
    const enemy = fighter({ agility: 15, slot: 1, strength: 10, hp: 999, maxHp: 999 });
    const state = makeState([self, enemy]);
    self.gauge = GAUGE_MAX;
    resolvePlayerCommand(state, rigRng(), { action: 'DEFEND' });
    expect(getStatus(self, 'GUARD')).toBeDefined(); // active immediately
    // Enemy hits for half damage while the guard holds, then the player's
    // next command phase begins and the guard is gone.
    runUntilPlayerCommand(state, rigRng({ ints: [10_000, 10_000, 10_000] }));
    expect(self.hp).toBe(46); // raw 8 halved to 4
    expect(getStatus(self, 'GUARD')).toBeUndefined();
  });
});

describe('flee', () => {
  it('is impossible in unfleeable encounters', () => {
    const self = fighter({ kind: 'PLAYER', gauge: GAUGE_MAX });
    const state = makeState([self, fighter()], { fleeable: false });
    expect(() => resolvePlayerCommand(state, rigRng(), { action: 'FLEE' })).toThrow(
      EngineRuleError,
    );
    expect(self.gauge).toBe(GAUGE_MAX); // nothing consumed
  });

  it('a failed attempt consumes the action and banks a retry bonus', () => {
    const self = fighter({ kind: 'PLAYER', gauge: GAUGE_MAX, agility: 10 });
    const enemy = fighter({ agility: 10, hp: 50 });
    const state = makeState([self, enemy]);
    const rng = rigRng({ chances: [false] });
    resolvePlayerCommand(state, rng, { action: 'FLEE' });
    expect(state.outcome).toBe('ACTIVE');
    expect(state.fleeAttempts).toBe(1);
    expect(self.gauge).toBe(0); // action consumed
    expect(rng.chanceCalls[0]).toBe(combatConfig.fleeBaseBps); // equal agility

    // The next attempt is easier by the retry bonus.
    self.gauge = GAUGE_MAX;
    const rng2 = rigRng({ chances: [true] });
    resolvePlayerCommand(state, rng2, { action: 'FLEE' });
    expect(rng2.chanceCalls[0]).toBe(combatConfig.fleeBaseBps + combatConfig.fleeRetryBonusBps);
    expect(state.outcome).toBe('FLED');
  });

  it('clamps the flee chance to the configured bounds', () => {
    const self = fighter({ kind: 'PLAYER', gauge: GAUGE_MAX, agility: 99 });
    const enemy = fighter({ agility: 1, hp: 50 });
    const state = makeState([self, enemy]);
    const rng = rigRng({ chances: [true] });
    resolvePlayerCommand(state, rng, { action: 'FLEE' });
    expect(rng.chanceCalls[0]).toBe(combatConfig.fleeMaxBps);
  });
});

describe('abilities', () => {
  it('Twin Cut lands two separately rolled hits', () => {
    const self = fighter({ kind: 'PLAYER', gauge: GAUGE_MAX, strength: 10, mp: 20 });
    const enemy = fighter({ defense: 8, hp: 50, agility: 1 });
    const state = makeState([self, enemy]);
    const ability = findAbility('wayfarer', 'twin-cut')!;
    resolvePlayerCommand(state, rigRng({ ints: [10_000, 10_000] }), {
      action: 'ABILITY',
      ability,
      targetId: enemy.id,
    });
    // power 8000 → offense 10; mitigation 4; 6 per hit × 2 hits
    expect(enemy.hp).toBe(38);
    expect(self.mp).toBe(20 - ability.mpCost);
  });

  it('Storm Pulse strikes every living enemy', () => {
    const self = fighter({ kind: 'PLAYER', gauge: GAUGE_MAX, magic: 12, mp: 20 });
    const a = fighter({ magicDefense: 8, hp: 50, agility: 1 });
    const b = fighter({ magicDefense: 8, hp: 50, agility: 1 });
    const state = makeState([self, a, b]);
    const ability = findAbility('arcanist', 'storm-pulse')!;
    resolvePlayerCommand(state, rigRng({ ints: [10_000, 10_000] }), {
      action: 'MAGIC',
      ability,
      targetId: a.id,
    });
    expect(a.hp).toBeLessThan(50);
    expect(b.hp).toBeLessThan(50);
  });

  it('rejects an ability the player cannot afford', () => {
    const self = fighter({ kind: 'PLAYER', gauge: GAUGE_MAX, mp: 1 });
    const enemy = fighter({ hp: 50 });
    const state = makeState([self, enemy]);
    const ability = findAbility('vanguard', 'heavy-strike')!;
    expect(() =>
      resolvePlayerCommand(state, rigRng(), { action: 'ABILITY', ability, targetId: enemy.id }),
    ).toThrow(EngineRuleError);
    expect(self.mp).toBe(1);
    expect(self.gauge).toBe(GAUGE_MAX);
  });

  it('every class has a full roster with staggered unlocks (Phase 23)', () => {
    for (const classSlug of ['vanguard', 'wayfarer', 'arcanist']) {
      const roster = CLASS_ABILITIES.filter((a) => a.classSlug === classSlug);
      // Six abilities per class, more than the loadout capacity, so builds
      // diverge; and more unlock past the starting tier.
      expect(roster).toHaveLength(6);
      expect(roster.filter((a) => a.unlockLevel > 1).length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('outcomes and determinism', () => {
  it('victory when the last enemy falls; defeat when the player falls', () => {
    const self = fighter({ kind: 'PLAYER', gauge: GAUGE_MAX, strength: 50 });
    const enemy = fighter({ hp: 1, defense: 0, agility: 1 });
    const state = makeState([self, enemy]);
    resolvePlayerCommand(state, rigRng({ ints: [10_000] }), {
      action: 'ATTACK',
      targetId: enemy.id,
    });
    expect(state.outcome).toBe('VICTORY');

    const frail = fighter({ kind: 'PLAYER', hp: 1, agility: 1, defense: 0, slot: 0 });
    const brute = fighter({ strength: 50, agility: 20, slot: 1 });
    brute.aiActions = [{ kind: 'ATTACK', name: 'Crush', weight: 1 }];
    const doom = makeState([frail, brute]);
    runUntilPlayerCommand(doom, rigRng({ ints: [10_000] }));
    expect(doom.outcome).toBe('DEFEAT');
  });

  it('the seeded PRNG is deterministic for a persisted (seed, counter) pair', () => {
    const a = createCombatRng('deadbeef', 0);
    const b = createCombatRng('deadbeef', 0);
    const drawsA = [a.nextInt(1, 1000), a.nextInt(1, 1000), a.chance(5000)];
    const drawsB = [b.nextInt(1, 1000), b.nextInt(1, 1000), b.chance(5000)];
    expect(drawsA).toEqual(drawsB);
    expect(a.counter).toBe(b.counter);
    // A different seed diverges; resuming mid-stream continues the sequence.
    const c = createCombatRng('deadbeef', 2);
    expect(c.chance(5000)).toBe(drawsA[2]);
  });
});
