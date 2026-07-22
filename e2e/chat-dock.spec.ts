import { expect, test } from '@playwright/test';

test('chat is pinned by default as a corner pill, expands, and can be unpinned', async ({
  page,
}) => {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  await page.goto('/register');
  await page.getByLabel('Email').fill(`pinner-${unique}@example.com`);
  await page.getByLabel('Display name').fill(`Pinner${unique.slice(-8)}`);
  await page.getByLabel('Password').fill('a sturdy passphrase 42');
  await page.getByRole('button', { name: 'Create account' }).click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Location' }).click();
  await page.getByRole('radio', { name: /Vanguard/ }).click();
  await page.getByLabel('Character name').fill(`Warden ${unique.slice(-6)}`);
  await page.getByRole('button', { name: 'Begin your journey' }).click();
  await expect(page).toHaveURL(/\/character$/);

  await nav.getByRole('link', { name: 'Location' }).click();

  // Pinned by default: a small corner pill is present on a non-chat page.
  const pill = page.getByRole('button', { name: 'Open chat' });
  await expect(pill).toBeVisible();

  // Expanding reveals the full dock with a composer.
  await pill.click();
  const dock = page.getByRole('complementary', { name: 'Pinned chat' });
  await expect(dock).toBeVisible();
  await expect(dock.getByPlaceholder('Type a message…')).toBeVisible();

  // Unpinning removes both the dock and the pill everywhere.
  await dock.getByRole('button', { name: 'Unpin chat' }).click();
  await expect(dock).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open chat' })).toBeHidden();
});
