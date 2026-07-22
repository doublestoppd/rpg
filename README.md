# Fantasy Economy RPG

A persistent, browser-based, menu-driven fantasy RPG with a regional economy
at its core: travel a graph of connected locations, gather and craft, fight
classic initiative-gauge combat, complete quests, collect artifacts, buy
limited NPC stock, and run a regional player shop. All content is original.

## Status

Built in strictly ordered phases. See [`docs/phase-progress.md`](docs/phase-progress.md)
for what exists today. **Currently: Phase 26 (Living World) in progress** — a
server-authoritative living-world layer, delivered as tested, gated increments.
Increment 1 lands the deterministic world clock (data-driven cycle and
DAWN/DAY/DUSK/NIGHT segments derived from server time via an injected clock) and
regional atmosphere (deterministic from a persisted server secret, lazily
finalized on read, worker-independent). See
[`docs/living-world.md`](docs/living-world.md).

Earlier highlights: **Phase 24** — repeatable activities (rotating bounty board,
equipment salvage, NPC sellback) as once-per-cycle, arbitrage-proof economy
loops. **Phase 23** — character builds, talents, respec, and combat build
snapshots. **Phases 19–20** — versioned content platform and the admin Content
Studio (publish onto live tables without a deploy). **Phase 18** — production
hardening and release validation. See [`docs/RELEASE.md`](docs/RELEASE.md),
[`docs/deployment.md`](docs/deployment.md),
[`docs/threat-model.md`](docs/threat-model.md), and the runbooks under `docs/`.

## Stack (fixed)

- Node.js 22 LTS (pinned in `.nvmrc`), TypeScript strict mode
- npm workspaces: `apps/web`, `apps/api`, `packages/shared`, `prisma`, `docs`
- Frontend: React, Vite, React Router, TanStack Query, Tailwind CSS
- Backend: Fastify REST API under `/api/v1`, Zod, Prisma, PostgreSQL
- Jobs: pg-boss (worker process; never the sole authority for timed state)
- Auth: HTTP-only cookie sessions (hashed in PostgreSQL), Argon2id, CSRF token + Origin validation
- Testing: Vitest, Fastify `inject()`, Playwright
- Architecture: modular monolith — no microservices, Redis, GraphQL, or event sourcing

Architecture decisions are recorded in [`docs/adr/`](docs/adr/); the overall
shape, layer boundaries, transaction/idempotency/locking rules, and where new
gameplay belongs are documented in [`docs/architecture.md`](docs/architecture.md).

## Repository layout

```
apps/api/         Fastify API + job worker entrypoints
apps/web/         React frontend
packages/shared/  Shared Zod schemas, enums, public types (the API contract)
prisma/           Prisma schema, migrations, seeds
docs/             ADRs and phase progress
scripts/          Repository tooling
tests/            Repository-level tests
```

## Getting started

Requires Node.js 22 (see `.nvmrc`) and Docker (for PostgreSQL).

```bash
docker compose up          # PostgreSQL + API dev + worker + web dev
```

Compose is self-contained and cross-platform: a one-shot `deps` service installs
Linux-native dependencies and generates the Prisma client into a container-owned
`node_modules` volume before the app services start, so it works from a macOS,
Windows, or Linux host regardless of what your host `node_modules` was built for.
The first `up` takes a minute while `deps` runs `npm ci`.

Then open http://localhost:5173. The web dev server proxies `/api` to the API
process.

For local tooling — tests, typecheck, lint, or running the processes directly
without Docker — install on the host and copy `.env.example` to `.env`:

```bash
npm ci                     # reproducible install from lockfile (host tooling)

```bash
npm run dev:api            # API with reload (needs DATABASE_URL)
npm run dev:worker         # pg-boss worker with reload
npm run dev:web            # Vite dev server
```

### Checks

```bash
npm run typecheck          # strict TypeScript across all workspaces
npm run lint               # ESLint (correctness + architectural boundaries)
npm test                   # Vitest suites (needs PostgreSQL; test DB auto-created)
npm run test:e2e           # Playwright against the production web build + real API
npm run verify:structure   # repository-structure contract check
npm run format:check       # Prettier
npm run build              # production builds (shared → api → web)
npm run api:baseline       # regenerate the OpenAPI compatibility baseline
```

CI (`.github/workflows/ci.yml`) runs format, lint, typecheck, structure,
tests (including index-plan and API-compatibility gates), and the build on
every push.

API tests use `TEST_DATABASE_URL` (default
`postgresql://rpg:rpg@localhost:5432/rpg_test`); Playwright uses
`E2E_DATABASE_URL` (default `..././rpg_e2e`). Both databases are created and
migrated automatically by `scripts/prepare-db.mjs`.

### Production

Production runs two Node processes plus static web assets (see ADR 0007):

```bash
npm run build              # emits apps/api/dist and apps/web/dist
npm run start:api          # Fastify API server
npm run start:worker       # pg-boss job worker (always a separate process)
```

`apps/web/dist` is served as static files by any web server or CDN; the Vite
dev server is never used in production. API docs (documentation only) are at
`/api/v1/docs`.

### Administration

There is no default administrator account. Promote an existing account
out-of-band (idempotent; in production requires `ADMIN_BOOTSTRAP_ENABLED=true`):

```bash
npm run admin:promote -- someone@example.com
```

Administrator mutations require ADMIN role, valid CSRF + Origin, and recent
password re-authentication (`POST /api/v1/admin/reauth`, default 10-minute
window). Every successful mutation writes an append-only, same-transaction
`AdminAuditLog` row. See [`docs/moderation-runbook.md`](docs/moderation-runbook.md),
[`docs/economy-metrics.md`](docs/economy-metrics.md), and ADRs 0010–0011.

## Conventions that never change

- Gold is PostgreSQL `BIGINT`, serialized as a decimal string in JSON.
  Quantities are integers; rates use integer basis points.
- All timestamps are UTC ISO 8601.
- All authoritative random outcomes are generated server-side; `Math.random()`
  is never used for them.
- Business logic lives in domain services; shared Zod schemas in
  `packages/shared` are the API contract.
