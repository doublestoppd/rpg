import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('bundled visual assets', () => {
  it('pass build-time validation (files exist, checksums match, fallbacks resolve)', () => {
    // Runs the same gate CI enforces, so a hand-edited SVG or a stale manifest
    // fails the test suite too (Phase 21 acceptance: every reference is valid).
    const run = () =>
      execFileSync('node', ['scripts/verify-assets.mjs'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
    expect(run).not.toThrow();
    expect(run()).toContain('Assets valid');
  });
});
