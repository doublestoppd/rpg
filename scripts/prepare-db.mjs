#!/usr/bin/env node
/**
 * Prepares a PostgreSQL database for tests or local runs: creates it if it
 * does not exist, then applies all Prisma migrations.
 *
 * Usage: node scripts/prepare-db.mjs [postgres-url]
 * Default URL: TEST_DATABASE_URL or postgresql://rpg:rpg@localhost:5432/rpg_test
 */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const targetUrl =
  process.argv[2] ??
  process.env.TEST_DATABASE_URL ??
  'postgresql://rpg:rpg@localhost:5432/rpg_test';

const parsed = new URL(targetUrl);
const dbName = parsed.pathname.replace(/^\//, '');
if (!dbName) {
  console.error(`prepare-db: URL has no database name: ${targetUrl}`);
  process.exit(1);
}

const adminUrl = new URL(targetUrl);
adminUrl.pathname = '/postgres';

try {
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`);
    console.log(`prepare-db: created database ${dbName}`);
  }
  await client.end();
} catch (error) {
  console.error(
    `prepare-db: cannot reach PostgreSQL at ${adminUrl.host}. ` +
      `Start it first (e.g. \`docker compose up postgres\`).\n${error}`,
  );
  process.exit(1);
}

execSync('npx prisma migrate deploy --schema prisma/schema.prisma', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: targetUrl },
});
console.log(`prepare-db: migrations applied to ${dbName}`);
