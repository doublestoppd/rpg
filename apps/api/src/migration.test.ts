import { execFileSync } from 'node:child_process';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_DATABASE_URL } from './test-helpers.js';

/**
 * Migration + seed validation (Phase 18): apply every migration to a clean
 * database with `prisma migrate deploy`, then run the seed twice and confirm it
 * is idempotent (no duplicate rows, stable counts). Uses a throwaway database.
 */

const CLEAN_DB = 'rpg_migrate_clean';
const adminUrl = new URL(TEST_DATABASE_URL);
adminUrl.pathname = '/postgres';
const cleanUrl = new URL(TEST_DATABASE_URL);
cleanUrl.pathname = `/${CLEAN_DB}`;

async function withAdmin(fn: (client: pg.Client) => Promise<void>) {
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await fn(admin);
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS "${CLEAN_DB}"`);
    await admin.query(`CREATE DATABASE "${CLEAN_DB}"`);
  });
});
afterAll(async () => {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS "${CLEAN_DB}"`);
  });
});

async function countRow(sql: string): Promise<number> {
  const client = new pg.Client({ connectionString: cleanUrl.toString() });
  await client.connect();
  try {
    const result = await client.query(sql);
    return result.rows[0].n as number;
  } finally {
    await client.end();
  }
}

describe('migrations and seed on a clean database', () => {
  it('applies every migration and seeds idempotently', () => {
    const env = { ...process.env, DATABASE_URL: cleanUrl.toString() };

    // Every migration applies cleanly from empty.
    execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
      env,
      stdio: 'pipe',
    });

    // Seed once, then again — the second run must not duplicate anything.
    execFileSync('node', ['prisma/seed.mjs'], { env, stdio: 'pipe' });
    execFileSync('node', ['prisma/seed.mjs'], { env, stdio: 'pipe' });
  }, 120_000);

  it('has stable, expected seed counts after a double seed', async () => {
    expect(await countRow('SELECT COUNT(*)::int AS n FROM "Location"')).toBe(8);
    expect(await countRow('SELECT COUNT(*)::int AS n FROM "ChatChannel"')).toBe(9);
    expect(await countRow('SELECT COUNT(*)::int AS n FROM "ItemDefinition"')).toBe(27);
    expect(await countRow('SELECT COUNT(*)::int AS n FROM "CharacterClassDefinition"')).toBe(3);
    // No live player state is created by seeds.
    expect(await countRow('SELECT COUNT(*)::int AS n FROM "Character"')).toBe(0);
    expect(await countRow('SELECT COUNT(*)::int AS n FROM "CurrencyAccount"')).toBe(0);
  });
});
