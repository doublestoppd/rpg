import { describe, expect, it } from 'vitest';

// @ts-expect-error -- plain .mjs script without type declarations
import { findMissingPaths, REQUIRED_PATHS } from '../scripts/verify-structure.mjs';

describe('repository structure (Phase 0 contract)', () => {
  it('declares all required workspace folders', () => {
    const paths = REQUIRED_PATHS as string[];
    expect(paths).toContain('apps/web/package.json');
    expect(paths).toContain('apps/api/package.json');
    expect(paths).toContain('packages/shared/package.json');
    expect(paths).toContain('prisma');
    expect(paths).toContain('docs');
  });

  it('finds no missing required paths', () => {
    expect(findMissingPaths()).toEqual([]);
  });
});
