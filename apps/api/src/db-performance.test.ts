import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_DATABASE_URL } from './test-helpers.js';

/**
 * Database performance verification (Phase 13B). Representative hot-path
 * queries must be servable by the expected index. Plans are captured with
 * EXPLAIN under `enable_seqscan = off`: on small test tables the planner
 * would otherwise prefer sequential scans, so disabling them reveals
 * whether a usable index path EXISTS — if the expected index is missing,
 * the forced plan still shows a sequential scan and the test fails. No
 * timing assertions: plans are stable, timings are not.
 */

let client: pg.Client;

beforeAll(async () => {
  client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query('SET enable_seqscan = off');
});

afterAll(async () => {
  await client.end();
});

async function explainPlan(sql: string, params: unknown[] = []): Promise<string> {
  const result = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);
  return JSON.stringify(result.rows[0]);
}

async function expectIndex(sql: string, indexNames: string | string[], params: unknown[] = []) {
  const acceptable = Array.isArray(indexNames) ? indexNames : [indexNames];
  const plan = await explainPlan(sql, params);
  // Any of the acceptable indexes may serve the query (the planner may
  // prefer an equally selective unique or partial index) — but never a
  // sequential scan, which would mean no usable index exists at all.
  expect(plan, `no index path for: ${sql}`).not.toContain('"Node Type":"Seq Scan"');
  expect(
    acceptable.some((name) => plan.includes(name)),
    `expected one of [${acceptable.join(', ')}] to serve: ${sql}\nplan: ${plan}`,
  ).toBe(true);
}

const someUuid = '00000000-0000-4000-8000-000000000000';

describe('inventory queries stay on their indexes', () => {
  it('stacks by character', async () => {
    await expectIndex(
      'SELECT * FROM "InventoryStack" WHERE "characterId" = $1',
      'InventoryStack_characterId',
      [someUuid],
    );
  });

  it('a specific stack by character + item (capacity math, grants, consumes)', async () => {
    await expectIndex(
      'SELECT * FROM "InventoryStack" WHERE "characterId" = $1 AND "itemDefinitionId" = $2',
      'InventoryStack_characterId_itemDefinitionId_key',
      [someUuid, someUuid],
    );
  });

  it('owned instances by character (also the future museum-donation lookup)', async () => {
    await expectIndex(
      'SELECT * FROM "ItemInstance" WHERE "ownerCharacterId" = $1',
      'ItemInstance_ownerCharacterId_idx',
      [someUuid],
    );
  });
});

describe('marketplace queries stay on their indexes', () => {
  it('active listings by expiry (lazy expiry sweeps)', async () => {
    await expectIndex(
      `SELECT * FROM "MarketplaceListing" WHERE "status" = 'ACTIVE' AND "expiresAt" <= now()`,
      'MarketplaceListing_status_expiresAt_idx',
    );
  });

  it('browse by item + status', async () => {
    await expectIndex(
      `SELECT * FROM "MarketplaceListing" WHERE "itemDefinitionId" = $1 AND "status" = 'ACTIVE'`,
      'MarketplaceListing_itemDefinitionId_status_idx',
      [someUuid],
    );
  });

  it('a seller their own listings', async () => {
    await expectIndex(
      `SELECT * FROM "MarketplaceListing" WHERE "sellerCharacterId" = $1 AND "status" = 'ACTIVE'`,
      ['MarketplaceListing_sellerCharacterId_status_idx', 'MarketplaceListing_sellerCharacterId'],
      [someUuid],
    );
  });
});

describe('combat and quest lookups stay on their indexes', () => {
  it('a character active combat', async () => {
    await expectIndex(
      `SELECT * FROM "Combat" WHERE "characterId" = $1 AND "status" = 'ACTIVE'`,
      ['Combat_characterId_status_idx', 'Combat_one_active_per_character'],
      [someUuid],
    );
  });

  it('a character quests by status (event handling reads ACTIVE quests)', async () => {
    await expectIndex(
      `SELECT * FROM "CharacterQuest" WHERE "characterId" = $1 AND "status" = 'ACTIVE'`,
      'CharacterQuest_characterId',
      [someUuid],
    );
  });
});

describe('notification preparation stays on indexes', () => {
  it('item transfers to a character (the future notification feed source)', async () => {
    await expectIndex(
      'SELECT * FROM "ItemTransfer" WHERE "toCharacterId" = $1',
      'ItemTransfer_toCharacterId_idx',
      [someUuid],
    );
  });
});

describe('chat queries stay on their indexes', () => {
  it('channel history by cursor order (channelId, createdAt, id)', async () => {
    await expectIndex(
      'SELECT * FROM "ChatMessage" WHERE "channelId" = $1 ORDER BY "createdAt" DESC, "id" DESC LIMIT 50',
      'ChatMessage_channelId_createdAt_id_idx',
      [someUuid],
    );
  });

  it('a message by author + idempotency key (send replay lookup)', async () => {
    await expectIndex(
      'SELECT * FROM "ChatMessage" WHERE "authorCharacterId" = $1 AND "idempotencyKey" = $2',
      'ChatMessage_authorCharacterId_idempotencyKey_key',
      [someUuid, 'k'],
    );
  });

  it('a reporter their report for a message (duplicate-report check)', async () => {
    await expectIndex(
      'SELECT * FROM "ChatReport" WHERE "reporterCharacterId" = $1 AND "messageId" = $2',
      'ChatReport_reporterCharacterId_messageId_key',
      [someUuid, someUuid],
    );
  });

  it('active restriction lookup by character', async () => {
    await expectIndex(
      `SELECT * FROM "ChatRestriction" WHERE "characterId" = $1 AND "status" = 'ACTIVE'`,
      'ChatRestriction_characterId_status_expiresAt_idx',
      [someUuid],
    );
  });

  it('a blocker their blocks', async () => {
    await expectIndex(
      'SELECT * FROM "ChatBlock" WHERE "blockerCharacterId" = $1',
      ['ChatBlock_pkey', 'ChatBlock_blockerCharacterId'],
      [someUuid],
    );
  });
});
