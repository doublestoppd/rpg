# ADR 0004: Timed-State Finalization (Lazy, Timestamp-Authoritative)

- Status: Accepted
- Date: 2026-07-16
- Phase: 0

## Context

Travel, gathering, crafting, deliveries, and listing expiry all complete at a
future time. Background jobs can fail, lag, or be down; game correctness must
not depend on them.

## Decision

1. **Timestamps are the authority.** A timed state stores `startedAt` and
   `completesAt` (UTC). It is logically complete the moment `completesAt`
   passes, regardless of whether any job has run.
2. **Lazy finalization.** Every relevant authenticated request first checks
   for expired timed states owned by the character and idempotently invokes
   the domain-specific finalizer before serving the request.
3. A small **shared timed-state helper** implements the timestamp check and
   exactly-once finalizer invocation. It is a utility, not a workflow engine.
4. **pg-boss is an accelerator, never the sole authority.** The API process
   may enqueue jobs; production job consumers run only in the worker process.
   A worker job may finalize early-and-idempotently or send notifications,
   but the game must remain fully correct with the worker stopped.
5. Finalizers are **idempotent and exactly-once** in effect: they lock the
   timed-state row, verify status, apply effects, and mark the state final in
   one transaction.

## Consequences

- Refreshing a page after a completion timestamp finalizes the state.
- Tests must pass with the worker process stopped.
- No permanent tick loops or polling loops run server-side.
