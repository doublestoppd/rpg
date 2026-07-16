# ADR 0006: Lightweight Synchronous Domain Events

- Status: Accepted
- Date: 2026-07-16
- Phase: 0

## Context

Later systems (quests, notifications, collections) react to verified actions
(travel completed, enemy defeated, item crafted, artifact donated). Progress
must be trustworthy — the frontend never submits progress — and often must be
atomic with the triggering action.

## Decision

1. Domain events are **typed in-process objects** (plain TypeScript
   discriminated unions defined alongside domain services, public shapes in
   `/packages/shared` only if they appear in API payloads).
2. Events are **dispatched synchronously** by the emitting domain service.
   When a consumer's consistency matters (quest progress), the handler runs
   **inside the same database transaction** as the emitting action.
3. Handlers are registered in code at startup; there is no discovery, no
   external bus, no persistence of events, and **no event sourcing**.
4. Events are emitted only after the emitting action is verified and applied
   within the transaction.
5. If a handler must not affect the emitting transaction (best-effort side
   effects such as WebSocket pushes), it is explicitly registered as
   post-commit.

## Consequences

- Quest progress can never diverge from the action that caused it.
- The mechanism stays small: a typed registry and a dispatch function.
- Scaling to an external bus is a deliberate future migration, not an
  accidental dependency.
