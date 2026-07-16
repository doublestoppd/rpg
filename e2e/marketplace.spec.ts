import { expect, test, type Page } from '@playwright/test';

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

async function startTravelToMarket(page: Page, nav: ReturnType<Page['getByRole']>) {
  await nav.getByRole('link', { name: 'Travel' }).click();
  await expect(page.getByText('Crownfall Market District', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set out' }).first().click();
  await expect(page.getByRole('progressbar')).toBeVisible();
}

test('a seller lists goods and another player buys them locally', async ({ browser }) => {
  test.setTimeout(150_000); // includes one 30s journey for both players
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  const sellerContext = await browser.newContext();
  const buyerContext = await browser.newContext();
  const seller = await sellerContext.newPage();
  const buyer = await buyerContext.newPage();

  const sellerNav = await registerAndCreate(seller, 'Seller', unique);
  const buyerNav = await registerAndCreate(buyer, 'Buyer', `${unique}b`);

  // Seller opens a shop registered to the crownfall region.
  await sellerNav.getByRole('link', { name: 'Marketplace' }).click();
  await seller.getByLabel('Shop name').fill(`Fine Goods ${unique.slice(-6)}`);
  await seller.getByRole('radio', { name: 'crownfall' }).click();
  await seller.getByRole('button', { name: 'Open shop' }).click();
  await expect(seller.getByText('Your shop is registered.')).toBeVisible();

  // Both players travel to the Market District concurrently (30s road).
  await startTravelToMarket(seller, sellerNav);
  await startTravelToMarket(buyer, buyerNav);
  await seller.waitForTimeout(32_000);

  // Seller lists a starter healing draught for 25 Gold from the inventory.
  await sellerNav.getByRole('link', { name: 'Inventory' }).click();
  await seller.reload(); // finalize arrival
  await seller.getByText('Lesser Healing Draught').click();
  await seller.getByLabel('Price (Gold)').fill('25');
  await seller.getByRole('button', { name: 'List for sale' }).click();
  await expect(seller.getByText('Listed on the marketplace.')).toBeVisible();

  // Buyer browses the marketplace and buys the listing.
  await buyerNav.getByRole('link', { name: 'Location' }).click();
  await buyer.reload(); // finalize arrival
  await buyerNav.getByRole('link', { name: 'Marketplace' }).click();
  const row = buyer
    .getByRole('listitem')
    .filter({ hasText: 'Lesser Healing Draught' })
    .filter({ hasText: '25 Gold' })
    .first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('local');
  await row.getByRole('button', { name: 'Buy' }).click();
  await buyer
    .getByRole('dialog')
    .getByRole('button', { name: /^Pay 25 Gold$/ })
    .click();
  await expect(buyer.getByText('Purchase complete for 25 Gold.')).toBeVisible();

  // The goods arrive immediately (local): 2 starter + 1 bought = 3 draughts.
  await buyerNav.getByRole('link', { name: 'Inventory' }).click();
  await expect(buyer.getByText('×3')).toBeVisible();

  // Seller sees proceeds in the ledger (25 - tax floor(25*500/10000)=1 → 24).
  await sellerNav.getByRole('link', { name: 'Character' }).click();
  await expect(seller.getByText('Market proceeds')).toBeVisible();
  await expect(seller.getByText('+24', { exact: true })).toBeVisible();

  await sellerContext.close();
  await buyerContext.close();
});
