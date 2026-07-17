# Fantasy Economy RPG

A persistent, browser-based, menu-driven fantasy RPG with a regional economy
at its core: travel a graph of connected locations, gather and craft, fight
classic initiative-gauge combat, complete quests, collect artifacts, buy
limited NPC stock, and run a regional player shop. All content is original.

## Status

Built in strictly ordered phases. See [`docs/phase-progress.md`](docs/phase-progress.md)
for what exists today. **Currently: Phase 10 complete** — timed mining at
Ironroot Mine: three weighted actions gated by a Mining skill, rewards rolled
with secure server RNG at start and stored server-privately (no pending leak,
no refresh reroll), stamina charged once, lazy exactly-once completion, and
capacity-blocked rewards held for claim — never rerolled or discarded.
Blacksmithing arrives in Phase 11.

## Stack (fixed)

- Node.js 22 LTS (pinned in `.nvmrc`), TypeScript strict mode
- npm workspaces: `apps/web`, `apps/api`, `packages/shared`, `prisma`, `docs`
- Frontend: React, Vite, React Router, TanStack Query, Tailwind CSS
- Backend: Fastify REST API under `/api/v1`, Zod, Prisma, PostgreSQL
- Jobs: pg-boss (worker process; never the sole authority for timed state)
- Auth: HTTP-only cookie sessions (hashed in PostgreSQL), Argon2id, CSRF token + Origin validation
- Testing: Vitest, Fastify `inject()`, Playwright
- Architecture: modular monolith — no microservices, Redis, GraphQL, or event sourcing

Architecture decisions are recorded in [`docs/adr/`](docs/adr/).

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
npm ci                     # reproducible install from lockfile
docker compose up          # PostgreSQL + API dev + worker + web dev
```

Then open http://localhost:5173. The web dev server proxies `/api` to the API
process. Copy `.env.example` to `.env` if running processes without Docker:

```bash
npm run dev:api            # API with reload (needs DATABASE_URL)
npm run dev:worker         # pg-boss worker with reload
npm run dev:web            # Vite dev server
```

### Checks

```bash
npm run typecheck          # strict TypeScript across all workspaces
npm test                   # Vitest suites (needs PostgreSQL; test DB auto-created)
npm run test:e2e           # Playwright against the production web build + real API
npm run verify:structure   # repository-structure contract check
npm run format:check       # Prettier
npm run build              # production builds (shared → api → web)
```

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

## Conventions that never change

- Gold is PostgreSQL `BIGINT`, serialized as a decimal string in JSON.
  Quantities are integers; rates use integer basis points.
- All timestamps are UTC ISO 8601.
- All authoritative random outcomes are generated server-side; `Math.random()`
  is never used for them.
- Business logic lives in domain services; shared Zod schemas in
  `packages/shared` are the API contract.
