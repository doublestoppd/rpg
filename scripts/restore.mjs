#!/usr/bin/env node
/**
 * PostgreSQL restore (Phase 18). Restores a custom-format dump produced by
 * scripts/backup.mjs into a target database with `pg_restore`. The target
 * should be a freshly created, empty database. See docs/backup-restore.md for
 * the full operational procedure (encryption, verification, RPO/RTO).
 *
 * Usage: node scripts/restore.mjs <TARGET_DATABASE_URL> <input-file>
 */
import { spawnSync } from 'node:child_process';

export function restoreDatabase(connectionString, inputFile) {
  const result = spawnSync(
    'pg_restore',
    ['--no-owner', '--no-privileges', '--dbname', connectionString, inputFile],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  // pg_restore may exit 1 on ignorable warnings; treat >1 as a hard failure and
  // surface non-zero for the caller to decide.
  return result.status ?? 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [url, input] = process.argv.slice(2);
  if (!url || !input) {
    console.error('usage: node scripts/restore.mjs <TARGET_DATABASE_URL> <input-file>');
    process.exit(2);
  }
  const status = restoreDatabase(url, input);
  console.log(`restore completed (pg_restore status ${status})`);
  process.exit(status > 1 ? 1 : 0);
}
