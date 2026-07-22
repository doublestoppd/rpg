import { expect, test } from '@playwright/test';

test('chat can be pinned to the bottom of every page and unpinned again', async ({ page }) => {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  await page.goto('/register');
  await page.getByLabel('Email').fill(`pinner-${unique}@example.com`);
  await page.getByLabel('Display name').fill(`Pinner${unique.slice(-8)}`);
  await page.getByLabel('Password').fill('a sturdy passphrase 42');
  await page.getByRole('button', { name: 'Create account' }).click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Character' }).click();
  await page.getByRole('radio', { name: /Vanguard/ }).click();
  await page.getByLabel('Character name').fill(`Warden ${unique.slice(-6)}`);
  await page.getByRole('button', { name: 'Begin your journey' }).click();
  await expect(page).toHaveURL(/\/character$/);

  // Pin chat from the Chat page.
  await nav.getByRole('link', { name: 'Chat' }).click();
  const dock = page.getByRole('complementary', { name: 'Pinned chat' });
  await expect(dock).toBeHidden(); // hidden on the Chat page itself
  await page.getByRole('button', { name: /Pin to bottom/ }).click();

  // On another page, the dock is present and usable.
  await nav.getByRole('link', { name: 'Location' }).click();
  await expect(dock).toBeVisible();
  await expect(dock.getByPlaceholder('Type a message…')).toBeVisible();

  // Unpinning removes it everywhere.
  await dock.getByRole('button', { name: 'Unpin chat' }).click();
  await expect(dock).toBeHidden();
});
