import { defineConfig } from '@playwright/test';

const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://rpg:rpg@localhost:5432/rpg_e2e';

// E2E tests run against the production web build served by `vite preview`
// (static assets — the dev server is never the production server), which
// proxies /api to a real API process backed by PostgreSQL.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173',
    // Prefer a pre-provisioned Chromium (e.g. containerized CI/dev environments)
    // over downloading a browser at install time.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  webServer: [
    {
      command: `node scripts/prepare-db.mjs ${E2E_DATABASE_URL} && npm run start --workspace apps/api`,
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: 'development',
        DATABASE_URL: E2E_DATABASE_URL,
        PORT: '3000',
        ALLOWED_ORIGINS: 'http://localhost:4173,http://localhost:5173',
        // Every spec registers fresh accounts; the strict production limit
        // (10/min) would rate-limit a full parallel run.
        AUTH_RATE_LIMIT_MAX: '200',
      },
    },
    {
      command: 'npm run preview --workspace apps/web',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
