import { expect, test } from '@playwright/test';

test('register, refresh persistence, and logout', async ({ page }) => {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const email = `traveler-${unique}@example.com`;
  const displayName = `Traveler${unique.slice(-8)}`;
  const password = 'a sturdy passphrase 42';

  // Register.
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Display name').fill(displayName);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Authenticated shell: Settings appears, login/register disappear.
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Log in' })).toHaveCount(0);

  // Session survives a full page refresh.
  await page.reload();
  await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();

  // Settings page shows the account and allows sign-out.
  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();

  // Back to the unauthenticated shell; guarded route redirects to login.
  await expect(nav.getByRole('link', { name: 'Log in' })).toBeVisible();
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login$/);

  // Log back in.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();
});
