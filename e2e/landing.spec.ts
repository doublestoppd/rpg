import { expect, test } from '@playwright/test';

test('landing page renders the neutral shell', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Fantasy Economy RPG/);
  await expect(page.getByRole('heading', { name: 'Welcome, traveler' })).toBeVisible();
  // Navigation shows only implemented destinations.
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link')).toHaveText(['Home']);
  // The dev-only health indicator must not render in the production build.
  await expect(page.getByTestId('dev-health-indicator')).toHaveCount(0);
});
