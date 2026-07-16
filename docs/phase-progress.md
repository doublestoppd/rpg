# Phase Progress

Running log of completed build phases. Each entry records what the phase
delivered and the commands it introduced.

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
