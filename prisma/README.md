# prisma

Prisma schema, migrations, and seed scripts live in this workspace directory.

Phase 0 intentionally contains no schema: database integration (Prisma client,
PostgreSQL via Docker Compose, and pg-boss infrastructure tables) is Phase 1
scope, and gameplay tables arrive with their owning phases.

Conventions (see `/docs/adr`):

- Gold amounts are PostgreSQL `BIGINT`, serialized as decimal strings in JSON.
- Quantities are integers; rates use integer basis points.
- All timestamps are UTC (`timestamptz`), serialized as ISO 8601.
- Parameterized raw SQL is allowed only inside repository functions for row
  locking or atomic conditional updates that Prisma cannot safely express.
