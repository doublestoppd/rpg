# ADR 0016 — Character builds, respec, and combat snapshots

Status: accepted (Phase 23, acceptance-core)

## Context

After enough level-20 content existed (Phase 22), progression needed room to
grow: a higher cap, meaningful build choices, and combat depth — without
destabilizing the server-authoritative combat engine or its guarantees. The
Phase 23 acceptance test is precise: every class has at least two viable
level-30 builds, respecs are exact and audited, active combats stay stable
across content publication, and all new combat commands remain replay-safe.

## Decision

**The level cap rises to 30 through the seeded progression table.** The cap is
the highest seeded `LevelProgression` row; extending the table to level 30 (with
strictly increasing cumulative XP) raises the cap. No code path assumed 20.

**Builds are a bounded loadout plus one talent per unlocked tier.** Each class
now has six abilities with staggered unlock levels; a character equips up to
`LOADOUT_CAPACITY` (four) of the unlocked ones. Six abilities in four slots make
more than one distinct loadout, and each of three talent tiers (unlocking at
levels 10/20/30) offers two mutually exclusive stat modifiers — so every class
has at least two viable level-30 builds. Talents and loadout live in one
`CharacterBuild` row; level and XP are never stored there.

**Respec is exact and audited via the ledger.** A trainer respec debits a
level-scaled Gold fee through the currency ledger and resets the loadout to
class defaults with no talents. The immutable `RESPEC_FEE` ledger entry is the
audit trail; the debit's idempotency key makes a replay a no-op (no double
charge, no second reset). "Exact" means deterministic reset with level and XP
untouched.

**Combat snapshots the build at the start of battle.** This is the keystone for
stability across content publication. Combat already snapshots every combatant's
stats into `CombatantState` and reads only that snapshot during the fight, so a
later content publish (which upserts live definitions) never alters an
in-progress battle. Phase 23 extends the snapshot to builds: at start, the
equipped loadout and chosen talents are frozen into `Combat.buildSnapshot`, and
the player's stats bake in the chosen talents. During the battle, the ability
command is validated against the snapshot loadout — not the live build — so a
mid-fight respec cannot change the battle either.

**Ability cooldowns are the new combat mechanic, and commands stay
replay-safe.** Abilities may declare `cooldownTurns`; the per-ability counters
live in `Combat.buildSnapshot.cooldowns`, tick down one per resolved command,
and the used ability is put on its full cooldown. An ability on cooldown, or one
not in the loadout, is rejected. All of this rides the existing combat command
transaction, which is already guarded by the combat `version` (optimistic
concurrency) and the `(character, idempotencyKey)` unique — so the new command
is replay-safe by construction: a stale version never resolves, and a duplicate
key returns the original result.

## Consequences

- Progression is meaningfully deeper (cap 30, six abilities, talents, loadouts)
  with at least two viable builds per class, and respec is safe and auditable.
- Active battles are provably insulated from content publishes and respecs
  because they read a start-of-battle snapshot, never live definitions.
- The combat engine's hard-won invariants (deterministic RNG, stat snapshots,
  version + idempotency) carry the new mechanics with minimal new surface.

## Scope (acceptance-core)

This phase delivers the four acceptance properties. Explicitly deferred within
Phase 23's ambit, and documented as follow-on: equipment tiers with set bonuses
or deterministic affix groups; the broader encounter-mechanics suite (multiple
waves, telegraphing, reinforcements, conditional phases, status resistance,
dispel/cleanse); and a brand-new gated boss built to exercise them. The
snapshot-at-start rule established here is the foundation those will build on.
