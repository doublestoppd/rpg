import { expect, type Page, test } from '@playwright/test';
import pg from 'pg';

const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://rpg:rpg@localhost:5432/rpg_e2e';

const PASSWORD = 'a sturdy passphrase 42';

async function register(page: Page, tag: string, unique: string) {
  const email = `${tag}-${unique}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Display name').fill(`${tag}${unique.slice(-8)}`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Character' }).click();
  await page.getByRole('radio', { name: /Vanguard/ }).click();
  const characterName = `${tag} ${unique.slice(-6)}`;
  await page.getByLabel('Character name').fill(characterName);
  await page.getByRole('button', { name: 'Begin your journey' }).click();
  await expect(page).toHaveURL(/\/character$/);
  return { nav, email, characterName };
}

/** Promote an account to ADMIN out-of-band (as the admin:promote CLI does). */
async function promote(email: string): Promise<void> {
  // Emails are stored normalized (lowercased) by the server.
  const normalized = email.trim().toLowerCase();
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const updated = await client.query('UPDATE "User" SET role = $1 WHERE email = $2', [
      'ADMIN',
      normalized,
    ]);
    if (updated.rowCount !== 1) throw new Error(`promote matched ${updated.rowCount} rows`);
    // Promotion revokes existing sessions; the user must log in afresh.
    await client.query(
      'UPDATE "Session" SET "revokedAt" = now() FROM "User" WHERE "Session"."userId" = "User".id AND "User".email = $1 AND "Session"."revokedAt" IS NULL',
      [normalized],
    );
  } finally {
    await client.end();
  }
}

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

test('an admin promotes, reauthenticates, inspects a player, and credits gold', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  const adminContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const player = await playerContext.newPage();

  const adminReg = await register(admin, 'Admin', unique);
  const playerReg = await register(player, 'Target', `${unique}p`);

  // Before promotion, the Admin nav link is absent.
  await expect(adminReg.nav.getByRole('link', { name: 'Admin' })).toHaveCount(0);

  // Promote out-of-band, then log in fresh (old session revoked). Clearing
  // cookies drops the now-revoked session so the login form renders cleanly.
  await promote(adminReg.email);
  await adminContext.clearCookies();
  await login(admin, adminReg.email);

  // The Admin nav link now appears; open the workspace.
  const adminNav = admin.getByRole('navigation', { name: 'Main navigation' });
  await adminNav.getByRole('link', { name: 'Admin' }).click();
  await expect(admin.getByRole('heading', { name: 'Administration' })).toBeVisible();

  // Mutations are locked until re-authentication.
  await expect(admin.getByText('Re-authentication required')).toBeVisible();
  await admin.getByLabel('Password').fill(PASSWORD);
  await admin.getByRole('button', { name: 'Confirm' }).click();
  await expect(admin.getByText('Player investigation')).toBeVisible();

  // Look up the target player and inspect.
  await admin.getByLabel('Search by character name').fill(playerReg.characterName);
  const row = admin.getByRole('listitem').filter({ hasText: playerReg.characterName }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Inspect' }).click();
  await expect(admin.getByRole('heading', { name: playerReg.characterName })).toBeVisible();

  // Credit 500 Gold with a reason; the balance updates (100 starting → 600).
  const goldForm = admin.locator('form').filter({ has: admin.getByText('Gold adjustment') });
  await goldForm.getByLabel('Amount (signed)').fill('500');
  await goldForm.getByLabel('Reason').fill('compensation for a verified bug');
  await goldForm.getByRole('button', { name: 'Apply' }).click();
  await expect(admin.getByText(/Balance is now 600 Gold/)).toBeVisible();

  // A non-admin cannot reach the admin workspace: the guard redirects away.
  await player.goto('/admin');
  await expect(player).not.toHaveURL(/\/admin$/);

  await adminContext.close();
  await playerContext.close();
});
