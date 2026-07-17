# ADR 0008 — Feature-module application composition

## Status

Accepted (Phase 13B).

## Context

By Phase 13 the application bootstrap constructed fifteen services and
registered fourteen route plugins in one 230-line function. Four more
feature phases (museum, notifications, admin, hardening) would each grow
it further, and the wiring order (currency before characters, quests
before every event emitter, finalizers pushed as their owners appear) was
implicit in statement order with nothing to catch a mistake.

## Decision

Each gameplay feature registers itself through a module in
`apps/api/src/modules/` exposing a single `register(ctx)` function. The
context carries the Fastify app, env, Prisma, the shared timed-state
finalizer list/runner, and a `ServiceRegistry` that modules populate as
they run. `GAME_MODULES` is an explicit ordered list; dependencies are
read with `requireService`, which fails startup loudly when the order is
wrong. `app.ts` keeps only infrastructure (server, error shape, logging,
docs, health).

We deliberately did not adopt a dependency-injection framework: explicit
construction in a fixed order is simpler, greppable, and sufficient for a
modular monolith of this size.

## Consequences

- Adding a feature touches its own module file plus one line in
  `modules/index.ts`; the composition test enforces both.
- The registry is filled progressively, so a module can only see services
  registered before it — making the dependency order part of the reviewed
  contract instead of an accident.
- API behavior is unchanged; the refactor is purely structural.
