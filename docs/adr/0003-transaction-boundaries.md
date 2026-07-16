# ADR 0003: Transaction Boundaries and Data-Access Rules

- Status: Accepted
- Date: 2026-07-16
- Phase: 0

## Context

The economy depends on invariants (no negative Gold, no duplicated items, no
lost stock) that must hold under concurrent requests, retries, and worker
downtime.

## Decision

1. **Business logic lives in domain services**, not in route handlers or React
   components. Route handlers validate, call a service, and map the result.
2. **Every multi-step state change is one database transaction.** Examples: a
   purchase debits Gold, decrements stock, adds inventory, and writes ledger
   and transfer records atomically, or not at all.
3. **Prisma is used for ordinary access.** Parameterized raw SQL is allowed
   only inside repository functions for row locking (`SELECT ... FOR UPDATE`)
   or atomic conditional updates that Prisma cannot safely express.
4. **Idempotency keys** guard every externally retryable mutation (travel
   start, purchases, listings, timed actions, combat commands, claims).
   A key is unique per character and operation namespace.
5. Balances and stock are protected with row locking or conditional atomic
   updates; "read, decide, write" without a lock is forbidden for contested
   rows.
6. Synchronous domain events (ADR 0006) that must be consistent with the
   triggering action are handled **inside the same transaction**.

## Consequences

- Services receive a transaction handle (Prisma interactive transaction) and
  never commit partial work.
- Repository functions with raw SQL are small, named, and unit-tested.
- HTTP handlers stay thin and cannot bypass invariants.
