# ADR 0010 — Administrator security and append-only audit

Status: accepted (Phase 17)

## Context

Phase 17 adds a privileged administrator surface: player investigation, Gold
and item operations, configuration edits, economy metrics, and chat
moderation. Privileged actions are high-value targets and must be
authenticated, authorized, rate-limited, and — above all — auditable in a way
that cannot be quietly rewritten.

## Decision

**No default or startup-created administrator.** There is no seeded admin
email or password anywhere in source, seed data, images, or normal startup. An
operator deliberately runs `npm run admin:promote -- <email-or-name>`, which
elevates an existing account, revokes its sessions (forcing a fresh login),
records a SYSTEM bootstrap audit row, is idempotent, refuses ambiguous targets
(case-insensitive match), and in production requires `ADMIN_BOOTSTRAP_ENABLED=true`.
No secret is passed on the command line.

**Recent-auth, not a second token.** Every administrator mutation and every
high-sensitivity player-detail read requires a recent password
re-authentication. `POST /admin/reauth` verifies the current password
(rate-limited, generic failure) and stamps `Session.adminReauthenticatedAt` on
the current server-side session only — no second long-lived bearer token is
issued. A configurable window (default 10 minutes) gates access; a password or
role change clears recent-auth (the session rotates). Authorization (ADMIN
role) and recent-auth are enforced by the API on every request; the frontend
guard and hidden nav are convenience only.

**Append-only business audit, separate from technical logs.** `AdminAuditLog`
is an authoritative business-audit domain, distinct from the Phase 13B
structured `authoritative mutation` technical log and from
CurrencyTransaction/ItemTransfer/ItemDestruction/MarketplaceSale/ChatReport —
it never replaces them. Every successful admin mutation writes exactly one
audit row in the **same transaction** as the domain change, keyed uniquely by
`(actorUserId, actionNamespace, idempotencyKey)` — that key doubles as the
mutation's idempotency guard. A PostgreSQL trigger rejects `UPDATE` and
`DELETE` on the table, so rows are immutable regardless of application role; a
database test proves it. `before`/`after` JSON is a small allowlist of
secret-free fields, never a serialized Prisma record, session, or password.

**Idempotent, atomic mutations backed by domain services.** Admin operations
call existing domain services (currency, inventory, npc-shops) rather than
duplicating mutation logic. Gold moves through the immutable ledger and cannot
go negative; item grants/removals honor capacity, stack/instance, and every
locked-state rule (no force path). A replay returns the original result and
creates no second effect; if the audit insert fails, the whole transaction
rolls back.

## Consequences

- Compromising an admin session still cannot silently rewrite history: the
  audit is immutable at the database level and every action is attributable.
- Recent-auth means a stolen long-lived cookie alone cannot perform mutations
  without the password, and the blast radius of a leaked session is bounded by
  the window.
- Admin operations inherit all existing domain invariants for free, because
  they go through the same services players do.
