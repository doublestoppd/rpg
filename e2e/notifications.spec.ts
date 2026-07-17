import { expect, type Page, test } from '@playwright/test';

async function registerAndCreate(page: Page, tag: string, unique: string) {
  await page.goto('/register');
  await page.getByLabel('Email').fill(`${tag}-${unique}@example.com`);
  await page.getByLabel('Display name').fill(`${tag}${unique.slice(-8)}`);
  await page.getByLabel('Password').fill('a sturdy passphrase 42');
  await page.getByRole('button', { name: 'Create account' }).click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Character' }).click();
  await page.getByRole('radio', { name: /Wayfarer/ }).click();
  await page.getByLabel('Character name').fill(`${tag} ${unique.slice(-6)}`);
  await page.getByRole('button', { name: 'Begin your journey' }).click();
  await expect(page).toHaveURL(/\/character$/);
  return nav;
}

test('an arrival lands in the notification center and the unread badge clears', async ({
  page,
}) => {
  test.setTimeout(120_000); // includes one 30s journey
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const nav = await registerAndCreate(page, 'Herald', unique);

  // No notifications yet.
  await nav.getByRole('link', { name: 'Notifications' }).click();
  await expect(page.getByText('Nothing yet')).toBeVisible();

  // Walk the 30-second road; the travel page's status polling finalizes the
  // arrival, which stores the notification in the same transaction.
  await nav.getByRole('link', { name: 'Travel' }).click();
  await expect(page.getByText('Crownfall Market District', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set out' }).first().click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.waitForTimeout(32_000);

  // The unread indicator appears (live socket nudge, or the 15s poll).
  await expect(nav.getByLabel('1 unread')).toBeVisible({ timeout: 20_000 });

  // The notification center shows the stored arrival.
  await nav.getByRole('link', { name: 'Notifications' }).click();
  await expect(page.getByText('You have arrived', { exact: true })).toBeVisible();
  await expect(page.getByText('The road ends at Crownfall Market District.')).toBeVisible();

  // Reading clears the indicator.
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(nav.getByLabel(/unread/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark all read' })).toHaveCount(0);
});
