#!/usr/bin/env node
/**
 * CI baseline-freeze check (Phase 18). Fails if the committed OpenAPI baseline
 * (apps/api/api-baseline.json) differs from the document the current app
 * generates — an unreviewed contract change must never merge silently. Run
 * `npm run api:baseline` to regenerate intentionally, then review the diff.
 *
 * This complements api-compat.test.ts (which allows additive changes): this
 * check requires the committed snapshot to be exactly regenerated.
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync('git', ['diff', '--exit-code', '--', 'apps/api/api-baseline.json'], {
  stdio: 'inherit',
});

if (result.status !== 0) {
  console.error(
    '\nAPI baseline is out of date or was changed without review.\n' +
      'If this change is intentional, run: npm run api:baseline\n' +
      'then commit the reviewed apps/api/api-baseline.json diff.',
  );
  process.exit(1);
}

// Regenerate into a temp copy and compare, so a stale-but-committed baseline is
// also caught (not just uncommitted edits).
const regen = spawnSync('npm', ['run', 'api:baseline'], { stdio: 'inherit' });
if (regen.status !== 0) process.exit(regen.status ?? 1);

const after = spawnSync('git', ['diff', '--exit-code', '--', 'apps/api/api-baseline.json'], {
  stdio: 'inherit',
});
if (after.status !== 0) {
  console.error(
    '\nThe committed API baseline does not match the generated contract.\n' +
      'Review the diff above; if intentional, commit the regenerated baseline.',
  );
  process.exit(1);
}
console.log('API baseline is frozen and up to date.');
