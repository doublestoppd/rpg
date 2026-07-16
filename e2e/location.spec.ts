import { expect, test } from '@playwright/test';

test('location hub shows Crownfall City, its features, and connected roads', async ({ page }) => {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  // Register and create a character.
  await page.goto('/register');
  await page.getByLabel('Email').fill(`walker-${unique}@example.com`);
  await page.getByLabel('Display name').fill(`Walker${unique.slice(-8)}`);
  await page.getByLabel('Password').fill('a sturdy passphrase 42');
  await page.getByRole('button', { name: 'Create account' }).click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Location' }).click();
  await page.getByRole('radio', { name: /Vanguard/ }).click();
  await page.getByLabel('Character name').fill(`Warden ${unique.slice(-6)}`);
  await page.getByRole('button', { name: 'Begin your journey' }).click();
  await expect(page).toHaveURL(/\/character$/); // wait out the post-creation redirect

  // The location hub for the starting city.
  await nav.getByRole('link', { name: 'Location' }).click();
  await expect(page.getByRole('heading', { name: 'Crownfall City' })).toBeVisible();
  await expect(page.getByText('Safe area')).toBeVisible();
  await expect(page.getByRole('img', { name: /Crownfall City/ })).toBeVisible();

  // Feature cards come from database records.
  const featuresSection = page.getByRole('region', { name: 'Local features' });
  await expect(featuresSection.getByText('Crownfall Inn', { exact: true })).toBeVisible();
  await expect(
    featuresSection.getByText('Museum of Regional Artifacts', { exact: true }),
  ).toBeVisible();

  // Only directly connected destinations are listed.
  const roads = page.getByRole('region', { name: 'Connected roads' }).getByRole('listitem');
  await expect(roads).toHaveText([/Crownfall Market District/, /Crownfall Harbor/, /North Road/]);
});
