# ADR 0002: API Contracts via Shared Zod Schemas

- Status: Accepted
- Date: 2026-07-16
- Phase: 0

## Context

The frontend and backend need one authoritative definition of every request
and response shape, and internal persistence types must not leak to clients.

## Decision

1. **Shared Zod schemas in `/packages/shared` are the API contract.** Request
   and response schemas, public enums, and public types are defined there and
   imported by both `apps/api` (for validation) and `apps/web` (for typing).
2. The REST API lives under **`/api/v1`** on Fastify. Every route validates
   input with the shared Zod schemas.
3. **OpenAPI is documentation only.** It is generated from Fastify route
   schemas for human consumption; the frontend client is **never** generated
   from OpenAPI.
4. **Internal database types never leak** into public responses. Domain
   services map Prisma models to the shared response schemas explicitly.
5. All timestamps in API payloads are UTC ISO 8601 strings.

## Consequences

- A schema change is a single edit in `/packages/shared`, and both apps fail
  type checking if they disagree with it.
- Response mapping code is explicit and testable; accidental exposure of
  columns (password hashes, session hashes, internal flags) is prevented by
  construction because responses are parsed through the shared schema.
