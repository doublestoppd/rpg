# ADR 0007: Process Model, Commands, and Deployment Shape

- Status: Accepted
- Date: 2026-07-16
- Phase: 0

## Context

The architecture is a modular monolith. Production still needs separate
always-on processes for HTTP traffic and background jobs, plus a static
frontend build.

## Decision

1. **Two production processes** from one codebase:
   - `npm run start:api` — the Fastify API server.
   - `npm run start:worker` — the pg-boss job consumer.
     The API process may enqueue jobs but never consumes them in production.
2. **Static frontend.** `apps/web` builds to static assets with Vite; the Vite
   dev server is never used in production.
3. In development, a convenience command may run API and worker together;
   production never does.
4. **Runtime pin.** Node.js 22 LTS, pinned in `.nvmrc` (`22.22.2`) and in all
   Docker images (`node:22-bookworm-slim`, introduced with Docker Compose in
   Phase 1). Dependencies are exact-versioned via the committed
   `package-lock.json`; prerelease packages are not allowed.
5. **Not in this architecture:** microservices, GraphQL, Redis, event
   sourcing, large UI component frameworks, or speculative abstractions.

## Consequences

- Deployment is: build static web assets, run one API process and one worker
  process against PostgreSQL.
- Horizontal scale-out of the API process is possible later because all
  authority lives in PostgreSQL (locks, timestamps, idempotency keys).

## Related scope decisions

- Password reset and email verification are **out of scope for the initial
  release**; accounts are active immediately after registration (Phase 2).
