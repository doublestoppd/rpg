import { expect, test } from '@playwright/test';

test('travel to a neighbor, blocked local actions, and arrival on refresh', async ({ page }) => {
  test.setTimeout(120_000); // includes a real 30s journey

  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  // Register and create a character.
  await page.goto('/register');
  await page.getByLabel('Email').fill(`nomad-${unique}@example.com`);
  await page.getByLabel('Display name').fill(`Nomad${unique.slice(-8)}`);
  await page.getByLabel('Password').fill('a sturdy passphrase 42');
  await page.getByRole('button', { name: 'Create account' }).click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Character' }).click();
  await page.getByRole('radio', { name: /Wayfarer/ }).click();
  await page.getByLabel('Character name').fill(`Vale ${unique.slice(-6)}`);
  await page.getByRole('button', { name: 'Begin your journey' }).click();

  // Set out for the Market District (shortest road, 30s; listed first).
  await nav.getByRole('link', { name: 'Travel' }).click();
  await expect(page.getByText('Crownfall Market District', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set out' }).first().click();

  // Progress UI appears; travel cannot be canceled.
  await expect(page.getByText(/On the road to Crownfall Market District/)).toBeVisible();
  await expect(page.getByRole('progressbar')).toBeVisible();

  // Local actions are unavailable while traveling.
  await nav.getByRole('link', { name: 'Location' }).click();
  await expect(page.getByText('You are on the road')).toBeVisible();

  // Wait out the journey, then a plain refresh of the location page
  // finalizes arrival (no worker, no websocket).
  await page.waitForTimeout(32_000);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Crownfall Market District' })).toBeVisible({
    timeout: 15_000,
  });

  // The market district features come from the registry.
  const featuresSection = page.getByRole('region', { name: 'Local features' });
  await expect(featuresSection.getByText('Crownfall General Goods')).toBeVisible();
});
