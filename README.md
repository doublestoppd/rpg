# Fantasy Economy RPG

A persistent, browser-based, menu-driven fantasy RPG with a regional economy
at its core: travel a graph of connected locations, gather and craft, fight
classic initiative-gauge combat, complete quests, collect artifacts, buy
limited NPC stock, and run a regional player shop. All content is original.

## Status

Built in strictly ordered phases. See [`docs/phase-progress.md`](docs/phase-progress.md)
for what exists today. **Currently: Phase 0 complete** — repository contract,
monorepo structure, and architecture decisions only. No gameplay, server, or
UI is implemented yet.

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

Requires Node.js 22 (see `.nvmrc`).

```bash
npm ci                     # reproducible install from lockfile
npm run typecheck          # strict TypeScript across all workspaces
npm test                   # Vitest test suites
npm run verify:structure   # repository-structure contract check
npm run format:check       # Prettier
```

### Process commands

Production runs two processes (see ADR 0007):

```bash
npm run start:api          # Fastify API server (implemented in Phase 1)
npm run start:worker       # pg-boss job worker (implemented in Phase 1)
```

Both are placeholders until Phase 1 and exit with an explanatory message.

## Conventions that never change

- Gold is PostgreSQL `BIGINT`, serialized as a decimal string in JSON.
  Quantities are integers; rates use integer basis points.
- All timestamps are UTC ISO 8601.
- All authoritative random outcomes are generated server-side; `Math.random()`
  is never used for them.
- Business logic lives in domain services; shared Zod schemas in
  `packages/shared` are the API contract.
