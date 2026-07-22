import { expect, test } from '@playwright/test';

test('the living scene shows the time of day, people present, and an authored conversation', async ({
  page,
}) => {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  // Register and create a character.
  await page.goto('/register');
  await page.getByLabel('Email').fill(`dweller-${unique}@example.com`);
  await page.getByLabel('Display name').fill(`Dweller${unique.slice(-8)}`);
  await page.getByLabel('Password').fill('a sturdy passphrase 42');
  await page.getByRole('button', { name: 'Create account' }).click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Location' }).click();
  await page.getByRole('radio', { name: /Vanguard/ }).click();
  await page.getByLabel('Character name').fill(`Warden ${unique.slice(-6)}`);
  await page.getByRole('button', { name: 'Begin your journey' }).click();
  await expect(page).toHaveURL(/\/character$/);

  await nav.getByRole('link', { name: 'Location' }).click();
  await expect(page.getByRole('heading', { name: 'Crownfall City' })).toBeVisible();

  // The scene banner: a world-time segment plus atmosphere chips.
  const atmosphere = page.getByRole('list', { name: 'Atmosphere' });
  await expect(atmosphere).toBeVisible();

  // People present at this location and segment. Brannic keeps the hearth at
  // every hour, so he is always here.
  const people = page.getByRole('region', { name: 'People here' });
  await expect(people.getByText('Brannic Hearthkeeper')).toBeVisible();

  // Open an authored conversation and walk one branch.
  await people.getByRole('button', { name: 'Talk' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/Rest your boots, traveler/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Just getting my bearings.' }).click();
  await expect(dialog.getByText(/Market's up the road/)).toBeVisible();

  // The player's chosen line is recorded in the transcript.
  await expect(dialog.getByText('Just getting my bearings.')).toBeVisible();

  // End and close the conversation.
  await dialog.getByRole('button', { name: 'Thanks, Brannic.' }).click();
  await page.getByRole('button', { name: /Done|Leave conversation/ }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // The local activity feed section is present (may be quiet for a fresh world).
  await expect(page.getByRole('region', { name: 'Local happenings' })).toBeVisible();
});
