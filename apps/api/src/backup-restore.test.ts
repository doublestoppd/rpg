import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Shared ESM script utilities (no types).
// @ts-expect-error - JS module without types.
import { backupDatabase } from '../../../scripts/backup.mjs';
// @ts-expect-error - JS module without types.
import { runIntegrityChecks } from '../../../scripts/integrity-check.mjs';
// @ts-expect-error - JS module without types.
import { restoreDatabase } from '../../../scripts/restore.mjs';
import { TEST_DATABASE_URL } from './test-helpers.js';

/**
 * Backup + restore smoke test (Phase 18): dump the migrated + seeded test
 * database, restore it into a freshly created database, then verify integrity
 * and that representative seed data is present. Requires pg_dump/pg_restore.
 */

const RESTORE_DB = 'rpg_restore_smoke';
const adminUrl = new URL(TEST_DATABASE_URL);
adminUrl.pathname = '/postgres';
const restoreUrl = new URL(TEST_DATABASE_URL);
restoreUrl.pathname = `/${RESTORE_DB}`;

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rpg-backup-'));
});
afterAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${RESTORE_DB}"`);
  } finally {
    await admin.end();
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe('backup and restore', () => {
  it('restores a dump into a fresh database with integrity intact', async () => {
    const dumpFile = join(tempDir, 'backup.dump');
    // 1. Back up the migrated + seeded test database.
    backupDatabase(TEST_DATABASE_URL, dumpFile);

    // 2. Create a fresh, empty target database.
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${RESTORE_DB}"`);
      await admin.query(`CREATE DATABASE "${RESTORE_DB}"`);
    } finally {
      await admin.end();
    }

    // 3. Restore into it.
    const status = restoreDatabase(restoreUrl.toString(), dumpFile) as number;
    expect(status).toBeLessThanOrEqual(1); // 0, or 1 for ignorable warnings

    // 4. Integrity holds on the restored database.
    const violations = (await runIntegrityChecks(restoreUrl.toString())) as unknown[];
    expect(violations).toEqual([]);

    // 5. Representative seed data survived the round trip.
    const restored = new pg.Client({ connectionString: restoreUrl.toString() });
    await restored.connect();
    try {
      const locations = await restored.query('SELECT COUNT(*)::int AS n FROM "Location"');
      expect(locations.rows[0].n).toBe(8);
      const channels = await restored.query('SELECT COUNT(*)::int AS n FROM "ChatChannel"');
      expect(channels.rows[0].n).toBe(9);
    } finally {
      await restored.end();
    }
  }, 60_000);
});
