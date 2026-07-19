# Backup, Restore, and Rollback

## Backup

Use `pg_dump` in the custom (compressed, restorable) format. The repo wraps it:

```bash
npm run backup -- "$DATABASE_URL" /backups/rpg-$(date +%Y%m%dT%H%M%SZ).dump
```

Operational requirements:

- **Encryption at rest** for backup artifacts and **encryption in transit** to
  off-host storage.
- **Access control:** backups contain password hashes and PII — restrict to the
  operations role.
- **Retention:** keep at least 7 daily + 4 weekly copies (tune to policy).
- **Verification:** every backup should be restore-tested on a schedule (the
  automated smoke test below is the reproducible primitive).

## Restore

Restore into a **freshly created, empty** database:

```bash
createdb rpg_restored          # or CREATE DATABASE via psql
npm run restore -- "postgresql://…/rpg_restored" /backups/<file>.dump
npm run integrity:check -- "postgresql://…/rpg_restored"
```

The automated smoke test (`apps/api/src/backup-restore.test.ts`) dumps the
migrated + seeded database, restores it into a fresh database, runs the
integrity checks, and asserts representative seed data survived — proving the
round trip end to end.

## Integrity checks

`npm run integrity:check -- "$DATABASE_URL"` runs read-only invariant queries
(ledger chain consistency, non-negative balances/stock, single active
travel/combat per character, sale↔listing linkage, unique notification dedupe
keys, chat report evidence present, reported messages undeletable, one currency
account per character). It exits non-zero on any violation and is safe against
production.

## RPO / RTO (operational goals, not guarantees)

- **RPO:** ≤ 24h with daily backups; tighten with WAL archiving / PITR if
  required.
- **RTO:** minutes-to-restore for a small database plus migration + readiness;
  measure against your data volume and revise.

## Rollback

PostgreSQL migrations are **forward-only** (Prisma has no down-migrations).
Rolling back a release therefore means one of:

1. **Application rollback with a compatible schema (preferred).** Because
   migrations in Phases 16–18 are additive (new tables/columns/indexes, no
   destructive changes), the previous application version keeps working against
   the newer schema (expand/contract). Redeploy the prior build; no schema
   change needed.
2. **Schema rollback via restore.** Only if a migration must be undone: restore
   the most recent pre-migration backup into a fresh database and repoint the
   app. Data written since the backup is lost — treat as a last resort.

Application rollback matrix:

| From → To | Schema action        | Notes                                                               |
| --------- | -------------------- | ------------------------------------------------------------------- |
| 18 → 17   | none (additive only) | Health `/live` `/ready`, metrics, cleanup drop out; no data change. |
| 17 → 16   | none (additive only) | Admin surface disabled; audit rows remain (harmless).               |
| 16 → 15   | none (additive only) | Chat disabled; chat rows remain (harmless).                         |

Always verify readiness (`/api/v1/health/ready`) and run `integrity:check`
after any restore or rollback.
