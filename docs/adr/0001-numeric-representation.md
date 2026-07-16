# ADR 0001: Numeric Representation for Gold, Quantities, and Rates

- Status: Accepted
- Date: 2026-07-16
- Phase: 0

## Context

The game is economy-centric. Currency amounts, item quantities, and fee/tax
rates must never suffer floating-point drift, silent truncation, or JSON
precision loss.

## Decision

1. **Gold** is stored in PostgreSQL as `BIGINT` and handled server-side as
   JavaScript `BigInt`. It is serialized in every JSON API response as a
   **decimal string** (for example `"12500"`), never as a JSON number.
2. **Quantities** (stack sizes, slot counts, stock counts) are plain integers
   within `Number.MAX_SAFE_INTEGER` and are validated as integers with Zod.
3. **Rates** (taxes, fees, modifiers) use **integer basis points** wherever
   possible. A basis-point charge on a gross amount is computed as
   `floor(gross * bps / 10000)` using `BigInt` arithmetic.
4. Configurable maxima (for example the marketplace listing price cap) must
   remain below `Number.MAX_SAFE_INTEGER` even though storage is `BIGINT`.
5. No floating-point arithmetic is used for any authoritative economic value.
   Combat math that needs fractions uses fixed-point integers (see ADR 0005
   and the combat phase).

## Consequences

- All currency mutation flows through a single currency service that parses
  and validates decimal strings into `BigInt` (ADR 0003).
- Frontend code treats Gold as an opaque decimal string and never performs
  arithmetic on it with `Number` when values may be large.
- Prisma schema uses `BigInt` fields for Gold columns.
