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

test('a courier accepts the market errand, walks the road, and claims the reward', async ({
  page,
}) => {
  test.setTimeout(120_000); // includes one 30s journey
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const nav = await registerAndCreate(page, 'Courier', unique);

  // The notice board lists all five quests, none accepted yet.
  await nav.getByRole('link', { name: 'Quests' }).click();
  await expect(page.getByText('Errand to the Market', { exact: true })).toBeVisible();
  await expect(page.getByText('Copper for the Forges', { exact: true })).toBeVisible();
  await expect(page.getByText('Prove Your Metal', { exact: true })).toBeVisible();
  await expect(page.getByText('Thin the Hollow', { exact: true })).toBeVisible();
  await expect(page.getByText('A Gift for the Museum', { exact: true })).toBeVisible();

  // Accept the travel errand: progress starts at 0/1.
  const errand = page
    .locator('div')
    .filter({ has: page.getByText('Errand to the Market', { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Accept quest' }) })
    .last();
  await errand.getByRole('button', { name: 'Accept quest' }).click();
  await expect(page.getByText('In progress').first()).toBeVisible();
  await expect(page.getByText('0/1').first()).toBeVisible();

  // Walk the 30-second road to the Market District.
  await nav.getByRole('link', { name: 'Travel' }).click();
  await expect(page.getByText('Crownfall Market District', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set out' }).first().click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.waitForTimeout(32_000);

  // Arrival finalizes lazily and the quest completes in the same transaction.
  await nav.getByRole('link', { name: 'Location' }).click();
  await page.reload();
  await nav.getByRole('link', { name: 'Quests' }).click();
  await expect(page.getByText('Complete — claim your reward')).toBeVisible();
  await expect(page.getByText('1/1').first()).toBeVisible();

  // Claim exactly once: the button disappears and the status flips.
  await page.getByRole('button', { name: 'Claim reward' }).click();
  await expect(page.getByText('Reward claimed: 30 XP, 15 Gold.')).toBeVisible();
  await expect(page.getByText('Claimed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Claim reward' })).toHaveCount(0);

  // The spoils reached the character sheet.
  await nav.getByRole('link', { name: 'Character' }).click();
  await expect(page.getByText('30 / 100 XP', { exact: false })).toBeVisible();
});
