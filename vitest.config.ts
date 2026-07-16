import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'apps/**/src/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
    environment: 'node',
    // API test files share one PostgreSQL database; run files serially so
    // truncation in one file cannot race another file's fixtures.
    fileParallelism: false,
  },
});
