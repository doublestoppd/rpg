# Architecture

How the Fantasy Economy RPG is put together, and where new code belongs.
ADRs in [`adr/`](adr/) record the decisions; this document describes the
resulting shape.

## The modular monolith

One API process, one worker process, one PostgreSQL database, one React
frontend. No microservices, no Redis, no GraphQL, no event sourcing, no
CQRS — deliberately (see the phase playbook and ADR 0001).

```
apps/api/src/
  app.ts            Bootstrap: server, error shape, logging, docs, health.
  modules/          Feature modules — the composition root (ADR 0008).
  routes/           HTTP handlers: validate, authorize, delegate, serialize.
  domain/<feature>/ Domain services: ALL business logic and DB access.
  lib/              Cross-cutting utilities (timed state, RNG, metrics, …).
  config/           Zod-validated game/combat configuration constants.
packages/shared/    Zod schemas + public types — THE API contract.
prisma/             Schema, migrations, idempotent seed.
apps/web/           React frontend (routes → pages → feature hooks).
```

## Layer boundaries

**Routes** validate input with shared Zod schemas, authorize via
`app.requireAuth`, call exactly one domain-service method, and return its
result. Routes never touch Prisma values, never move Gold or items, never
mutate quest progress, never run combat logic. ESLint enforces the
database boundary (`@typescript-eslint/no-restricted-imports` on
`routes/*`).

**Domain services** own business rules, transactions, and persistence.
They are factory functions with explicit dependencies — no DI container.
Internal database types never leak: services map rows to shared-contract
types before returning.

**React components** render server state and submit commands. They never
implement gameplay rules, re-derive authoritative calculations, or
duplicate server validation beyond basic form ergonomics. Every number the
player sees comes from an API response.

## Application composition (feature modules)

`app.ts` handles infrastructure only. Every gameplay feature lives in a
module under `modules/` exposing one `register(ctx)` function that
constructs its services, wires dependencies from the shared
`ServiceRegistry`, pushes any timed-state finalizers, and registers its
routes. `GAME_MODULES` fixes the order; `requireService` turns a
mis-ordered list into a loud startup failure. Adding a feature means
adding a module file and one line to `modules/index.ts` — the composition
test in `architecture.test.ts` will insist on both.

## Transaction rules

- Every authoritative mutation happens inside one Prisma transaction that
  either fully commits or fully rolls back: charge + create, consume +
  start, flip + grant.
- Concurrent mutations for one character serialize on the character row
  lock (`inventoryService.lockCharacter`, raw `SELECT … FOR UPDATE` —
  ADR 0003). Combat serializes on the combat row instead.
- Exactly-once effects use a conditional `updateMany` on the current
  status _before_ the effect, in the same transaction; losing racers see
  `count === 0` and stop.
- Gold changes go through the currency service only, which locks the
  account row and writes exactly one immutable ledger entry per change.

## Timed state (ADR 0004)

A timestamp is the authority; rows finalize lazily. Modules owning timed
state (travel, marketplace deliveries/expiry, gathering, crafting) push a
`TimedStateFinalizer` into the shared list at registration; every
location-dependent request runs all of them first. The pg-boss worker only
sweeps stragglers — it is never the sole authority. Finalizers must be
idempotent and exactly-once in effect.

## Idempotency conventions

- Client-initiated starts (travel, gathering, crafting, combat, purchases,
  listings) carry a client `idempotencyKey`, unique per character +
  operation table. Replays return the original row and charge nothing —
  never an error, never a second effect.
- Combat commands instead use optimistic concurrency: `expectedVersion`
  must match, replays and stale clients get 409 and consume nothing.
- Ledger entries are idempotent per account + operation namespace + key.

## Domain events (Phase 13)

`QuestEventSink.handle(tx, characterId, event)` is called by travel,
gathering, crafting, and combat _inside the same transaction_ as their
verified action — quest progress commits or rolls back atomically with
the action. Synchronous, typed, in-process; deliberately not an event
bus. New event types extend the `QuestDomainEvent` union.

## Real-time delivery (Phase 15–16)

PostgreSQL rows are authoritative; the WebSocket is a best-effort enhancement
(ADR 0004, 0009). One authenticated socket — `/api/v1/notifications/ws`,
owned by the notifications module and shared by chat — carries a small
discriminated-union of envelope events (`sync` nudges,
`chat.message.created` invalidations). Events carry identifiers only; clients
fetch data over REST, and 10–15s polling is the complete fallback.

The socket upgrade validates the cookie session and Origin; inbound frames are
size-capped, a periodic sweep heartbeats connections and closes sockets whose
session was revoked or expired, and the hub disconnects slow consumers instead
of buffering without bound. Across API instances, chat commits fan out via
PostgreSQL `LISTEN/NOTIFY` (identifier-only payloads, listener reconnects with
backoff); missed notifications are repaired by polling. No Redis, no broker.

## Administration and audit (Phase 17)

The administration module extends existing domain services (currency,
inventory, npc-shops, chat) rather than duplicating mutation logic; admin
route handlers stay thin and never import Prisma. There is no default
administrator — `npm run admin:promote` elevates an existing account
out-of-band (ADR 0010). Every admin mutation requires ADMIN role, CSRF +
Origin, and recent password re-authentication (a server-side session marker,
not a second token), and writes exactly one append-only `AdminAuditLog` row in
the same transaction as the domain change. A PostgreSQL trigger makes that
table immutable (no UPDATE/DELETE). Configuration edits use optimistic
`configVersion` compare-and-set; structural fields are never mutable
(ADR 0011). Economy metrics are computed only from authoritative database
records (ledger, transfers, destructions, sales) — never from the resettable
process counters — and are documented in `docs/economy-metrics.md`. Chat
moderation redacts to a tombstone (never hard-deletes), preserves report
evidence, and never reveals the reporter.

## Observability

- Every state-changing request logs one structured `authoritative
mutation` entry (request id, account, route-pattern operation,
  idempotency key, duration, outcome). Bodies are never logged; pino
  redaction covers tokens and passwords elsewhere.
- `lib/metrics.ts` keeps process-local operational counters (idempotency
  replays, concurrency conflicts, combat/marketplace/quest conflicts,
  worker failures, lazy finalizer runs, and chat counters: accepted
  messages, idempotent replays, rate-limit and authorization rejections,
  reports, socket disconnects, listener reconnects, polling recoveries).
  Fixed name set, no high-cardinality labels, never player-visible.

## Quality gates

CI (`.github/workflows/ci.yml`) fails on Prettier, ESLint, TypeScript,
tests (including DB index-plan checks in `db-performance.test.ts` and the
API compatibility gate in `api-compat.test.ts`), or build errors. The
committed `apps/api/api-baseline.json` snapshots the generated OpenAPI
document; removing endpoints, properties, enum members, or required
fields fails the compatibility test. Regenerate after intentional
contract changes with `npm run api:baseline`.

## Testing conventions

- Vitest against real PostgreSQL (`rpg_test`), files serialized so
  truncation cannot race. Locking behavior is always tested against the
  real database.
- Concurrency scenarios use `test-concurrency.ts` helpers
  (`raceRequests`, `expectSingleWinner`, `replayRequest`,
  `expectIdempotentReplay`, `raceFinalizers`).
- Playwright runs against the production web build and a real API.

## Where new gameplay belongs

1. Schema + migration in `prisma/`, seed data in `seed-data.mjs`
   (validated in `seed.mjs`).
2. Contract schemas in `packages/shared/src/<feature>.ts`.
3. A domain service in `apps/api/src/domain/<feature>/` owning all rules.
4. Thin routes in `apps/api/src/routes/<feature>.ts`.
5. A feature module in `apps/api/src/modules/<feature>.ts`, listed in
   `GAME_MODULES`.
6. Frontend hooks + UI under `apps/web/src/features/<feature>/`.
7. Tests: service/API suite, engine-style unit tests for pure logic, a
   Playwright journey, and new tables added to `truncateAll`.
