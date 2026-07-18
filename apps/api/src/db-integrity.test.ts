import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The integrity checks are plain ESM utilities shared with the CLI script.
// @ts-expect-error - JS module without types, imported for its runtime export.
import { INTEGRITY_CHECKS, runIntegrityChecks } from '../../../scripts/integrity-check.mjs';
import { createTestPrisma, TEST_DATABASE_URL } from './test-helpers.js';

/**
 * Database integrity checks (Phase 18). The migrated + seeded test database
 * must satisfy every invariant with zero violations.
 */
describe('database integrity checks', () => {
  const prisma = createTestPrisma();
  beforeAll(async () => {
    await prisma.$queryRawUnsafe('SELECT 1');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('defines a non-trivial set of read-only invariant checks', () => {
    expect((INTEGRITY_CHECKS as unknown[]).length).toBeGreaterThanOrEqual(10);
  });

  it('reports zero violations on the migrated + seeded database', async () => {
    const violations = (await runIntegrityChecks(TEST_DATABASE_URL)) as Array<{ name: string }>;
    expect(violations).toEqual([]);
  });
});
