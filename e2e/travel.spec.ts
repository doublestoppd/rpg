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
  await expect(page).toHaveURL(/\/character$/); // wait out the post-creation redirect

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

  // Browse the general goods shop and buy something with limited stock.
  const generalGoodsCard = featuresSection
    .locator('div')
    .filter({ hasText: 'Crownfall General Goods' });
  await generalGoodsCard
    .getByRole('link', { name: /Browse wares/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Crownfall General Goods' })).toBeVisible();
  await expect(page.getByText('Your Gold:')).toBeVisible();

  // Buy 1 of the first purchasable entry via the confirmation dialog.
  await page.getByRole('button', { name: 'Buy', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('buy-quantity')).toHaveText('1');
  await dialog.getByRole('button', { name: /^Pay \d+ Gold$/ }).click();
  await expect(page.getByText(/^Bought 1 × /)).toBeVisible();

  // The purchase shows up in the pack.
  await nav.getByRole('link', { name: 'Inventory' }).click();
  await expect(page.getByTestId('slot-usage')).not.toHaveText('2 / 24 slots');
});
