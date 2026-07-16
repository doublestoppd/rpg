#!/usr/bin/env node
/**
 * Verifies the required monorepo structure (Phase 0 repository contract).
 * Exits non-zero and lists every missing path if the structure is violated.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const REQUIRED_PATHS = [
  'apps/web/package.json',
  'apps/api/package.json',
  'packages/shared/package.json',
  'prisma',
  'docs',
  'docs/adr/0001-numeric-representation.md',
  'docs/adr/0002-api-contracts.md',
  'docs/adr/0003-transaction-boundaries.md',
  'docs/adr/0004-timed-state-finalization.md',
  'docs/adr/0005-random-number-generation.md',
  'docs/adr/0006-synchronous-domain-events.md',
  'docs/adr/0007-process-model-and-commands.md',
  'docs/phase-progress.md',
  '.nvmrc',
  '.env.example',
  'compose.yaml',
  'package.json',
  'package-lock.json',
  'playwright.config.ts',
  'prisma/schema.prisma',
  'tsconfig.base.json',
];

export function findMissingPaths(baseDir = root) {
  return REQUIRED_PATHS.filter((p) => !existsSync(join(baseDir, p)));
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const missing = findMissingPaths();
  if (missing.length > 0) {
    console.error('Repository structure check FAILED. Missing paths:');
    for (const p of missing) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`Repository structure check passed (${REQUIRED_PATHS.length} required paths).`);
}
