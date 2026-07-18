# Chat Moderation Runbook

Operational guide for administrators handling chat reports. All actions require
ADMIN role and recent password re-authentication (`POST /admin/reauth`), carry
a mandatory reason, and are recorded in the append-only `AdminAuditLog` plus an
explicit `ChatModerationAction` record.

## Bootstrapping an administrator

There is no default administrator. Promote an existing account out-of-band:

```bash
npm run admin:promote -- someone@example.com
```

The command elevates the account to ADMIN, revokes its existing sessions (the
user logs in again), records a SYSTEM bootstrap audit row, and is idempotent.
In production it refuses to run unless `ADMIN_BOOTSTRAP_ENABLED=true`.

## Reviewing reports

- `GET /api/v1/admin/chat/reports?status=OPEN` lists open reports with the
  immutable evidence snapshot (message text at report time), the author, the
  channel, and whether the live message is already redacted.
- **Reporter identity is never shown** — not in the API, the UI, or any
  player-facing notification. Do not attempt to infer or disclose it.

## Actions

| Situation                               | Action                                                                                                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message is abusive and should be hidden | `POST /admin/chat/messages/:id/redact` — replaces the body with a tombstone. The row, author, ordering, and report evidence are preserved. Redaction is not reversible and never a hard delete. |
| Author needs a timeout                  | `POST /admin/chat/restrictions` with an optional `expiresAt` (omit for indefinite). Enforced immediately by the send service.                                                                   |
| A restriction was applied in error      | `POST /admin/chat/restrictions/:id/revoke` — history is preserved; sending is restored.                                                                                                         |
| Report handled or not actionable        | `POST /admin/chat/reports/:id/resolve` with `RESOLVED` or `DISMISSED`. The evidence snapshot survives resolution.                                                                               |

## Guarantees

- Redaction preserves a tombstone and ordering; report snapshots and audit
  evidence are never destroyed, and reported messages are undeletable by
  retention cleanup.
- Restrictions are timestamp-authoritative: an expired or revoked restriction
  is treated as inactive lazily, with no worker required.
- Player-facing moderation communication states the action category and
  duration only — never the reporter, never private admin notes.

## Idempotency

Every mutation takes an `idempotencyKey`. A replay returns the original result
and creates no second effect (no duplicate redaction, restriction, resolution,
or audit row).
