import { defineConfig } from '@playwright/test';

// E2E tests run against the production web build served by `vite preview`
// (static assets — the dev server is never the production server).
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
  webServer: {
    command: 'npm run preview --workspace apps/web',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
