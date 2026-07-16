import { expect, test } from '@playwright/test';

test('inventory shows the starter kit; equipping updates stats and slots', async ({ page }) => {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  // Register and create a Vanguard.
  await page.goto('/register');
  await page.getByLabel('Email').fill(`packrat-${unique}@example.com`);
  await page.getByLabel('Display name').fill(`Packrat${unique.slice(-8)}`);
  await page.getByLabel('Password').fill('a sturdy passphrase 42');
  await page.getByRole('button', { name: 'Create account' }).click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Character' }).click();
  await page.getByRole('radio', { name: /Vanguard/ }).click();
  await page.getByLabel('Character name').fill(`Carter ${unique.slice(-6)}`);
  await page.getByRole('button', { name: 'Begin your journey' }).click();
  await expect(page).toHaveURL(/\/character$/); // wait out the post-creation redirect

  // Inventory shows the starter kit: 2 draughts (stack) + tunic (instance).
  await nav.getByRole('link', { name: 'Inventory' }).click();
  await expect(page.getByTestId('slot-usage')).toHaveText('2 / 24 slots');
  await expect(page.getByText('Lesser Healing Draught')).toBeVisible();
  await expect(page.getByText('×2')).toBeVisible();
  await expect(page.getByText('Quilted Tunic')).toBeVisible();

  // Search filters the list.
  await page.getByLabel('Search').fill('tunic');
  await expect(page.getByText('Lesser Healing Draught')).toHaveCount(0);
  await expect(page.getByText('Quilted Tunic')).toBeVisible();

  // Item detail dialog → equip.
  await page.getByText('Quilted Tunic').click();
  await expect(page.getByRole('dialog')).toContainText('stitched wool padding');
  await page.getByRole('dialog').getByRole('button', { name: 'Equip', exact: true }).click();
  await expect(page.getByText('Quilted Tunic equipped.')).toBeVisible();

  // Equipped item frees its slot and is badged.
  await expect(page.getByTestId('slot-usage')).toHaveText('1 / 24 slots');
  await page.getByLabel('Search').fill('');
  await expect(page.getByText('Equipped', { exact: true })).toBeVisible();

  // Character page: equipment panel + stat bonuses. Equipping raises max HP
  // (Vanguard 120 + 5 tunic) without healing: 120 / 125.
  await nav.getByRole('link', { name: 'Character' }).click();
  await expect(page.getByText('120 / 125')).toBeVisible();
  const bodyRow = page.getByRole('listitem').filter({ hasText: 'Body' }).first();
  await expect(bodyRow).toContainText('Quilted Tunic');

  // Unequip returns it to the pack.
  await bodyRow.getByRole('button', { name: 'Unequip' }).click();
  await expect(page.getByText('120 / 120')).toBeVisible();
});
