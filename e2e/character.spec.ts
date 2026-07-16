import { expect, test } from '@playwright/test';

test('create a character and view persistent stats', async ({ page }) => {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const email = `founder-${unique}@example.com`;

  // Register a fresh account.
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Display name').fill(`Founder${unique.slice(-8)}`);
  await page.getByLabel('Password').fill('a sturdy passphrase 42');
  await page.getByRole('button', { name: 'Create account' }).click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Character' })).toBeVisible();

  // Character page redirects to creation when no character exists.
  await nav.getByRole('link', { name: 'Character' }).click();
  await expect(page).toHaveURL(/\/character\/new$/);

  // Pick a class and create.
  const characterName = `Ash ${unique.slice(-6)}`;
  await page.getByRole('radio', { name: /Arcanist/ }).click();
  await page.getByLabel('Character name').fill(characterName);
  await page.getByRole('button', { name: 'Begin your journey' }).click();

  // Creation persists and redirects to the character page.
  await expect(page).toHaveURL(/\/character$/);
  await expect(page.getByRole('heading', { name: characterName })).toBeVisible();
  await expect(page.getByText('Level 1 Arcanist')).toBeVisible();
  await expect(page.getByText('HP')).toBeVisible();
  await expect(page.getByText('80 / 80')).toBeVisible(); // Arcanist base HP
  await expect(page.getByText('Magic Defense')).toBeVisible();

  // Survives a refresh.
  await page.reload();
  await expect(page.getByRole('heading', { name: characterName })).toBeVisible();

  // Creation page now redirects back to the character.
  await page.goto('/character/new');
  await expect(page).toHaveURL(/\/character$/);
});
