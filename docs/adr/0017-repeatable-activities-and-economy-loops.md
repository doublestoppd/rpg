# ADR 0017 — Repeatable activities, rotation, and economy sinks

Status: accepted (Phase 24, acceptance-core)

## Context

The game had one-shot content (quests, collections) but no repeatable loop to
give returning players a reason to play each day and no structured Gold/item
sinks to counter accumulation. Phase 24 adds repeatable activities. Its
acceptance test is precise: rotation changes cannot duplicate rewards, salvage
preserves the destruction and transfer records, NPC sellback cannot produce
guaranteed arbitrage, and every repeatable reward is exactly once per character
and cycle. Two constraints shaped the design: eligibility and reward claims must
remain correct with the worker stopped (per ADR 0004, timed state is
timestamp-authoritative and pg-boss is never the sole authority), and every new
economic action must ride the existing ledger/transfer/destruction trails.

## Decision

**Rotation is a pure function of the current timestamp — no rotation state is
stored.** A fixed `BOUNTY_POOL` (daily and weekly entries) is filtered each
request by a deterministic hash selection keyed by the cycle identifier: the UTC
day (`YYYY-MM-DD`) for daily bounties, the ISO week (`YYYY-Www`) for weekly. The
same `now()` always yields the same board and the same cycle id. Because nothing
is written on a schedule, the board and eligibility are correct even if the
worker never runs — there is no rotation job to miss. This is the ADR 0004 rule
applied to content rotation: derive from the clock, never from a background
writer.

**"Exactly once per character and cycle" is enforced by a unique plus a
deterministic idempotency key, not by application checks.** A claim writes a
`BountyClaim` with `@@unique(characterId, cycleId, bountySlug)`; the reward
credit uses the deterministic key `cycleId:bountySlug`. Inside the claim
transaction an existing `BountyClaim` short-circuits to an idempotent no-op that
consumes nothing and pays nothing. A rotation change cannot duplicate a reward
because a new cycle is a new `cycleId` (a genuinely new claim), and a re-claim
within a cycle collides on the unique and the credit key. A stale claim from a
past cycle is keyed to that past `cycleId`, so it never blocks the current one.

**Salvage is a net item sink that preserves both economic trails.** Salvaging an
unequipped, unlisted equipment instance sets `destroyedAt`, writes an
append-only `ItemDestruction`, and grants a fixed material yield through the
inventory service (recording an `ItemTransfer`). Ownership is deliberately
retained on the destroyed instance: a destroyed instance never consumes an
inventory slot (`countUsedSlots` filters `destroyedAt: null`), and keeping
ownership means a replayed salvage of the same instance resolves to
`ALREADY_SALVAGED` (409) rather than a misleading `UNKNOWN_ITEM` (404).

**NPC sellback is arbitrage-proof by a pricing invariant, not by a runtime
guard.** The sell unit price is `base × regional modifier × sellbackBps`.
`sellbackBps` is validated strictly below `markupBps`, so for any shop and any
region the sell price is strictly below the buy price. A buy-then-sell round trip
therefore always loses Gold — no code path can produce a guaranteed profit. The
sale credits first (idempotent by the client key) and removes goods only when the
credit actually applied, so a replay never double-pays or double-removes.

## Consequences

- Players have a daily/weekly reason to return, and the game has real Gold and
  item sinks (salvage, sellback, bounty turn-ins) to counter accumulation.
- Rotation and eligibility need no scheduled job and no rotation table; they
  survive a stopped worker by construction, consistent with ADR 0004.
- Repeatable rewards are once-per-cycle by a database unique and a deterministic
  ledger key, so they inherit the same replay-safety as every other mutation.
- Every new action leaves the same auditable trail as the rest of the economy
  (`CurrencyTransaction`, `ItemTransfer`, `ItemDestruction`).

## Scope (acceptance-core)

This phase delivers the four acceptance properties via the bounty board,
equipment salvage, and NPC sellback. Explicitly deferred within Phase 24's ambit,
and documented as follow-on: regional contract chains, rotating world elites,
profession commissions, material refinement, collection-completion rewards, and a
player-facing activity calendar. The timestamp-derived rotation and
unique-plus-deterministic-key idempotency established here are the foundation
those will build on.
