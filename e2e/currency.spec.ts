import { expect, test } from '@playwright/test';

test('gold ledger shows the starting grant; the inn takes no idle money', async ({ page }) => {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  await page.goto('/register');
  await page.getByLabel('Email').fill(`ledger-${unique}@example.com`);
  await page.getByLabel('Display name').fill(`Ledger${unique.slice(-8)}`);
  await page.getByLabel('Password').fill('a sturdy passphrase 42');
  await page.getByRole('button', { name: 'Create account' }).click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Character' }).click();
  await page.getByRole('radio', { name: /Wayfarer/ }).click();
  await page.getByLabel('Character name').fill(`Fenn ${unique.slice(-6)}`);
  await page.getByRole('button', { name: 'Begin your journey' }).click();
  await expect(page).toHaveURL(/\/character$/); // wait out the post-creation redirect

  // The ledger card shows the starting grant with running balance.
  await expect(page.getByText('Recent ledger')).toBeVisible();
  await expect(page.getByText('Starting grant')).toBeVisible();
  await expect(page.getByText('+100', { exact: true })).toBeVisible();

  // The inn card appears only in Crownfall City with its rest action.
  await nav.getByRole('link', { name: 'Location' }).click();
  const featuresSection = page.getByRole('region', { name: 'Local features' });
  await expect(featuresSection.getByText('Crownfall Inn', { exact: true })).toBeVisible();
  const restButton = page.getByRole('button', { name: /^Rest/ });
  await expect(restButton).toBeVisible();

  // Fully rested characters are turned away before any Gold moves.
  await restButton.click();
  await expect(page.getByText('You are already fully rested.')).toBeVisible();

  // Balance unchanged.
  await nav.getByRole('link', { name: 'Character' }).click();
  await expect(page.getByText('Gold:')).toBeVisible();
  await expect(page.getByText('100', { exact: true })).toBeVisible();
});
