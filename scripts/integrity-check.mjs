#!/usr/bin/env node
/**
 * Database integrity checks (Phase 18). Read-only queries asserting the
 * economy and gameplay invariants that must always hold. Exits non-zero on any
 * violation. Safe to run against production (no writes). Also exported for the
 * integrity test.
 *
 * Usage: node scripts/integrity-check.mjs [DATABASE_URL]
 */
import pg from 'pg';

/**
 * Each check returns rows that represent VIOLATIONS — an empty result is a
 * pass. Keep every query read-only.
 */
export const INTEGRITY_CHECKS = [
  {
    name: 'currency ledger chain is consistent (after = before + amount)',
    sql: `SELECT id FROM "CurrencyTransaction"
          WHERE "balanceAfter" <> "balanceBefore" + "amount" LIMIT 5`,
  },
  {
    name: 'currency account balance is never negative',
    sql: `SELECT id FROM "CurrencyAccount" WHERE "balance" < 0 LIMIT 5`,
  },
  {
    name: 'inventory stacks are strictly positive',
    sql: `SELECT id FROM "InventoryStack" WHERE "quantity" <= 0 LIMIT 5`,
  },
  {
    name: 'NPC shop stock is never negative',
    sql: `SELECT id FROM "NpcShopStockEntry" WHERE "quantityRemaining" < 0 LIMIT 5`,
  },
  {
    name: 'at most one in-progress travel per character',
    sql: `SELECT "characterId" FROM "TravelState" WHERE "status" = 'IN_PROGRESS'
          GROUP BY "characterId" HAVING COUNT(*) > 1 LIMIT 5`,
  },
  {
    name: 'at most one active combat per character',
    sql: `SELECT "characterId" FROM "Combat" WHERE "status" = 'ACTIVE'
          GROUP BY "characterId" HAVING COUNT(*) > 1 LIMIT 5`,
  },
  {
    name: 'each marketplace sale has exactly one listing',
    sql: `SELECT s.id FROM "MarketplaceSale" s
          LEFT JOIN "MarketplaceListing" l ON l.id = s."listingId"
          WHERE l.id IS NULL LIMIT 5`,
  },
  {
    name: 'notification dedupe keys are unique per character',
    sql: `SELECT "characterId", "dedupeKey" FROM "Notification"
          GROUP BY "characterId", "dedupeKey" HAVING COUNT(*) > 1 LIMIT 5`,
  },
  {
    name: 'every chat report retains its evidence snapshot',
    sql: `SELECT id FROM "ChatReport" WHERE "snapshotBody" IS NULL LIMIT 5`,
  },
  {
    name: 'reported chat messages still exist (undeletable evidence)',
    sql: `SELECT r.id FROM "ChatReport" r
          LEFT JOIN "ChatMessage" m ON m.id = r."messageId"
          WHERE m.id IS NULL LIMIT 5`,
  },
  {
    name: 'one currency account per character',
    sql: `SELECT "characterId" FROM "CurrencyAccount"
          GROUP BY "characterId" HAVING COUNT(*) > 1 LIMIT 5`,
  },
];

export async function runIntegrityChecks(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const violations = [];
  try {
    for (const check of INTEGRITY_CHECKS) {
      const result = await client.query(check.sql);
      if (result.rows.length > 0) {
        violations.push({ name: check.name, count: result.rows.length });
      }
    }
  } finally {
    await client.end();
  }
  return violations;
}

// Direct invocation.
if (import.meta.url === `file://${process.argv[1]}`) {
  const url =
    process.argv[2] ?? process.env.DATABASE_URL ?? 'postgresql://rpg:rpg@localhost:5432/rpg';
  runIntegrityChecks(url)
    .then((violations) => {
      if (violations.length === 0) {
        console.log(`integrity: all ${INTEGRITY_CHECKS.length} checks passed`);
        process.exit(0);
      }
      for (const v of violations) {
        console.error(`integrity VIOLATION: ${v.name} (${v.count} rows)`);
      }
      process.exit(1);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
