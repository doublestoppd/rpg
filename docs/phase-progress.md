# Phase Progress

Running log of completed build phases. Each entry records what the phase
delivered and the commands it introduced.

## Phase 1 — Foundation and Runtime Infrastructure (2026-07-16)

**Status: complete.**

### Delivered

- **API (`apps/api`)**: Fastify 5 under `/api/v1` with Zod validation
  (`fastify-type-provider-zod`), structured JSON logging with request IDs and
  secret/cookie/authorization redaction, generic production error envelope,
  `GET /api/v1/health` (200 ok / 503 degraded with database status), and
  OpenAPI documentation generated from route schemas at `/api/v1/docs`
  (documentation only — the frontend client is never generated from it).
- **Environment validation** at startup (`src/config/env.ts`): the API and
  worker refuse to start with invalid configuration and list every problem.
- **Worker (`apps/api/src/worker.ts`)**: separate pg-boss process; creates
  pg-boss infrastructure tables on first start; no job types registered yet.
- **Prisma** (`prisma/schema.prisma`): datasource/generator only — pg-boss
  manages its own tables and gameplay tables arrive with their owning phases,
  so there are no application models or migrations yet.
- **Shared contract (`packages/shared`)**: health and error-envelope Zod
  schemas; package now builds to `dist` and is consumed by both apps.
- **Web (`apps/web`)**: React 19, Vite 8, React Router 7, TanStack Query 5,
  and Tailwind CSS 4. Responsive shell (desktop sidebar, mobile top bar) with
  only implemented navigation (Home), neutral landing page, and a
  development-only API health indicator (absent from production builds).
  UI foundation: Button, Card, Dialog, LoadingState, ErrorState, EmptyState,
  Toast.
- **Docker Compose** (`compose.yaml`): PostgreSQL 17, API dev service, worker,
  and web dev service (Vite proxying `/api` to the API container).
- **Playwright** e2e baseline against the production web build via
  `vite preview` (the dev server is never the production server).

### Commands

| Command                                                      | Purpose                                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `docker compose up`                                          | PostgreSQL + API dev + worker + web dev (run `npm ci` on the host first)      |
| `npm run dev:api` / `npm run dev:worker` / `npm run dev:web` | Local dev processes without Docker                                            |
| `npm run build`                                              | Production builds: shared → API → static web assets                           |
| `npm run start:api`                                          | Production API process (requires `npm run build` and `DATABASE_URL`)          |
| `npm run start:worker`                                       | Production worker process (separate from the API)                             |
| `npm run db:generate`                                        | Generate the Prisma client                                                    |
| `npm run test:e2e`                                           | Playwright (set `PLAYWRIGHT_CHROMIUM_PATH` to reuse a pre-installed Chromium) |

### Tests

- Health endpoint: 200 with database ok, 503 degraded on database failure,
  OpenAPI spec exposure, generic 404 envelope.
- Environment validation: defaults, missing/invalid values, aggregated errors.
- Production builds verified for shared, API, and web; Playwright verifies the
  landing shell, implemented-only navigation, and that the dev health
  indicator is absent in production.

### Known limitations

- No gameplay: the landing page is a neutral shell; authentication is Phase 2.
- `docker compose up` was validated for config and its exact commands were
  exercised directly against local PostgreSQL; container image pulls were
  blocked by this build environment's network policy (Docker Hub CDN), so the
  full containerized boot should be confirmed on an unrestricted machine.

## Phase 0 — Repository Contract and Project Inspection (2026-07-16)

**Status: complete.**

The repository was empty; Phase 0 initialized it.

### Delivered

- npm-workspace monorepo: `apps/web`, `apps/api`, `packages/shared`,
  `prisma/`, `docs/` (workspaces are minimal placeholders; no gameplay, no
  server, no UI has been implemented).
- Node.js 22 LTS pinned in `.nvmrc` (`22.22.2`); Docker images (Phase 1) must
  use `node:22-bookworm-slim`.
- TypeScript strict mode via shared `tsconfig.base.json`.
- Architecture decision records in `docs/adr/`:
  - 0001 numeric representation (BIGINT Gold, decimal-string JSON, basis points)
  - 0002 API contracts (shared Zod schemas; OpenAPI is documentation only)
  - 0003 transaction boundaries (domain services, atomic transactions, raw SQL rules, idempotency keys)
  - 0004 timed-state finalization (lazy, timestamp-authoritative; pg-boss never sole authority)
  - 0005 random number generation (Node crypto / seeded deterministic PRNG with persisted counter)
  - 0006 lightweight synchronous domain events (in-process, same transaction; no bus)
  - 0007 process model and commands (`start:api`, `start:worker`; static frontend; version pinning)
- Repository-structure verification script and test.
- Baseline Vitest setup with passing tests.
- Prettier formatting configuration.

### Dependency versions (exact, resolved via committed `package-lock.json`)

All tooling dependencies are stable releases; no prerelease packages.

| Package     | Version |
| ----------- | ------- |
| typescript  | 5.9.3   |
| vitest      | 4.1.10  |
| prettier    | 3.9.5   |
| @types/node | 22.20.1 |

Runtime: Node.js 22 LTS (`.nvmrc` pins `22.22.2`).

### Commands

| Command                                   | Purpose                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `npm ci`                                  | Reproducible install from the committed lockfile                       |
| `npm run typecheck`                       | TypeScript strict type checking across workspaces                      |
| `npm test`                                | Vitest (structure test + baseline tests)                               |
| `npm run verify:structure`                | Standalone repository-structure check                                  |
| `npm run format` / `npm run format:check` | Prettier                                                               |
| `npm run start:api`                       | API process (placeholder until Phase 1; exits with a clear message)    |
| `npm run start:worker`                    | Worker process (placeholder until Phase 1; exits with a clear message) |

### Known limitations

- `start:api` and `start:worker` are contract placeholders that exit with an
  explanatory error; Phase 1 implements the real processes.
- No database, Docker Compose, or production build exists yet (Phase 1 scope).
