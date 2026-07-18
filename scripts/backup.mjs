#!/usr/bin/env node
/**
 * PostgreSQL backup (Phase 18). Wraps `pg_dump` in the custom format, which is
 * compressed and restorable with `pg_restore`. This script is deliberately
 * thin: production backups should run pg_dump on a schedule with encryption
 * and off-host retention (see docs/backup-restore.md); this is the reproducible
 * primitive the restore smoke test also uses.
 *
 * Usage: node scripts/backup.mjs <DATABASE_URL> <output-file>
 */
import { spawnSync } from 'node:child_process';

export function backupDatabase(connectionString, outputFile) {
  const result = spawnSync(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-privileges', '--file', outputFile, connectionString],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pg_dump exited with status ${result.status}`);
  return outputFile;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [url, out] = process.argv.slice(2);
  if (!url || !out) {
    console.error('usage: node scripts/backup.mjs <DATABASE_URL> <output-file>');
    process.exit(2);
  }
  backupDatabase(url, out);
  console.log(`backup written to ${out}`);
}
