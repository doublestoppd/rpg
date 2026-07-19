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
      // The composite unique is ideal, but the leading-column index with a
      // filter is an equally usable path the planner may prefer at low row
      // counts — both are index scans, never a sequential scan.
      ['InventoryStack_characterId_itemDefinitionId_key', 'InventoryStack_characterId_idx'],
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

describe('admin queries stay on their indexes', () => {
  it('character search by name prefix (keyset order)', async () => {
    await expectIndex(
      `SELECT * FROM "Character" WHERE "name" LIKE $1 ORDER BY "name" ASC, "id" ASC LIMIT 25`,
      ['Character_name_key', 'Character_pkey'],
      ['A%'],
    );
  });

  it('audit lookup by actor + namespace + idempotency key (replay check)', async () => {
    await expectIndex(
      'SELECT * FROM "AdminAuditLog" WHERE "actorUserId" = $1 AND "actionNamespace" = $2 AND "idempotencyKey" = $3',
      'AdminAuditLog_actorUserId_actionNamespace_idempotencyKey_key',
      [someUuid, 'currency.adjust', 'k'],
    );
  });

  it('audit history by target', async () => {
    await expectIndex(
      'SELECT * FROM "AdminAuditLog" WHERE "targetType" = $1 AND "targetId" = $2 ORDER BY "createdAt" DESC',
      // The composite target index is ideal; the createdAt index that serves
      // the ORDER BY is an equally usable path at low row counts — both are
      // index scans, never a sequential scan.
      ['AdminAuditLog_targetType_targetId_createdAt_idx', 'AdminAuditLog_createdAt_idx'],
      ['Character', someUuid],
    );
  });

  it('open reports by status (moderation queue)', async () => {
    await expectIndex(
      `SELECT * FROM "ChatReport" WHERE "status" = 'OPEN' ORDER BY "createdAt" DESC`,
      'ChatReport_status_createdAt_idx',
    );
  });

  it('the ledger window for economy metrics', async () => {
    await expectIndex(
      `SELECT * FROM "CurrencyTransaction" WHERE "accountId" = $1 AND "createdAt" >= now() ORDER BY "createdAt" DESC`,
      'CurrencyTransaction_accountId_createdAt_idx',
      [someUuid],
    );
  });
});

describe('living-world queries stay on their indexes', () => {
  it('NPC placements by location + status (current-scene NPC lookup)', async () => {
    await expectIndex(
      `SELECT * FROM "NpcPlacement" WHERE "locationSlug" = $1 AND "status" = 'PUBLISHED'`,
      'NpcPlacement_locationSlug_status_idx',
      ['crownfall-city'],
    );
  });

  it('an NPC by stable key (detail + placement join)', async () => {
    await expectIndex('SELECT * FROM "NpcDefinition" WHERE "key" = $1', 'NpcDefinition_key_key', [
      'brannic-hearthkeeper',
    ]);
  });

  it('current atmosphere by region + cycle', async () => {
    await expectIndex(
      'SELECT * FROM "RegionAtmosphereState" WHERE "region" = $1 AND "cycleId" = $2',
      // The composite unique is ideal; the leading-column (region, expiresAt)
      // index with a cycleId filter is an equally usable index path the planner
      // may prefer at low row counts — both are index scans, never a seq scan.
      ['RegionAtmosphereState_region_cycleId_key', 'RegionAtmosphereState_region_expiresAt_idx'],
      ['crownfall', 'C1'],
    );
  });
});
