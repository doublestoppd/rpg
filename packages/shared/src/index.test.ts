import { describe, expect, it } from 'vitest';

import { SHARED_PACKAGE_NAME } from './index.js';

describe('baseline', () => {
  it('shared package is importable', () => {
    expect(SHARED_PACKAGE_NAME).toBe('@rpg/shared');
  });
});
