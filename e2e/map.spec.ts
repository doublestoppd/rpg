import { expect, test } from '@playwright/test';

test('the world map shows every location, the roads between them, and “you are here”', async ({
  page,
}) => {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  await page.goto('/register');
  await page.getByLabel('Email').fill(`cartographer-${unique}@example.com`);
  await page.getByLabel('Display name').fill(`Carto${unique.slice(-8)}`);
  await page.getByLabel('Password').fill('a sturdy passphrase 42');
  await page.getByRole('button', { name: 'Create account' }).click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Location' }).click();
  await page.getByRole('radio', { name: /Vanguard/ }).click();
  await page.getByLabel('Character name').fill(`Warden ${unique.slice(-6)}`);
  await page.getByRole('button', { name: 'Begin your journey' }).click();
  await expect(page).toHaveURL(/\/character$/);

  await nav.getByRole('link', { name: 'Map' }).click();
  await expect(page.getByRole('heading', { name: 'World map' })).toBeVisible();

  // The schematic diagram is present and labeled for assistive tech.
  await expect(page.getByRole('img', { name: /World map showing locations/ })).toBeVisible();

  // The accessible adjacency list names distant, not-yet-connected places too.
  await expect(page.getByText('Ironroot Mine')).toBeVisible();
  await expect(page.getByText('Silvermere Lake')).toBeVisible();

  // The starting location is marked as the current position.
  await expect(page.getByText('You are here').first()).toBeVisible();
});
