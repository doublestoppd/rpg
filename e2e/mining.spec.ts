import { expect, type Page, test } from '@playwright/test';
import pg from 'pg';

const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://rpg:rpg@localhost:5432/rpg_e2e';

async function registerAndCreate(page: Page, tag: string, unique: string) {
  await page.goto('/register');
  await page.getByLabel('Email').fill(`${tag}-${unique}@example.com`);
  await page.getByLabel('Display name').fill(`${tag}${unique.slice(-8)}`);
  await page.getByLabel('Password').fill('a sturdy passphrase 42');
  await page.getByRole('button', { name: 'Create account' }).click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Character' }).click();
  await page.getByRole('radio', { name: /Wayfarer/ }).click();
  const name = `${tag} ${unique.slice(-6)}`;
  await page.getByLabel('Character name').fill(name);
  await page.getByRole('button', { name: 'Begin your journey' }).click();
  await expect(page).toHaveURL(/\/character$/);
  return { nav, name };
}

/**
 * Test fixture: stands the character at Ironroot Mine directly in the e2e
 * database. The in-game roads to the mine take 150-180s each, which is the
 * travel spec's concern — this spec is about mining itself.
 */
async function placeAtIronrootMine(characterName: string) {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const updated = await client.query(
      `UPDATE "Character" SET "currentLocationId" =
         (SELECT id FROM "Location" WHERE slug = 'ironroot-mine')
       WHERE name = $1`,
      [characterName],
    );
    expect(updated.rowCount).toBe(1);
  } finally {
    await client.end();
  }
}

test('a miner works a copper seam: timed run, hidden reward, revealed haul', async ({ page }) => {
  test.setTimeout(90_000); // includes one 12s timed mining run
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  const { nav, name } = await registerAndCreate(page, 'Miner', unique);
  await placeAtIronrootMine(name);

  // The mine's location page offers the Mining Galleries with three actions.
  await nav.getByRole('link', { name: 'Location' }).click();
  await expect(page.getByRole('heading', { name: 'Ironroot Mine' })).toBeVisible();
  await expect(page.getByText('Mining Galleries')).toBeVisible();
  await expect(page.getByText('Mining level 1', { exact: false })).toBeVisible();
  await expect(page.getByText('Mine Copper Seam', { exact: true })).toBeVisible();
  await expect(page.getByText('Mine Iron Vein', { exact: true })).toBeVisible();
  await expect(page.getByText('Search Crystal Pocket', { exact: true })).toBeVisible();
  // Higher-level work is visibly locked at Mining level 1.
  await expect(page.getByText('Requires Mining level 4')).toBeVisible();
  await expect(page.getByText('Requires Mining level 2')).toBeVisible();

  // Start the copper seam (the only unlocked action has an enabled button).
  await page.getByRole('button', { name: 'Start work' }).first().click();
  await expect(page.getByRole('progressbar')).toBeVisible();

  // While the run is pending the reward stays server-private: nothing on the
  // page names a haul, and a refresh changes nothing (no reroll, no reveal).
  await expect(page.getByText(/Copper Ore ×|Iron Ore ×/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByText(/Copper Ore ×|Iron Ore ×/)).toHaveCount(0);
  // Action buttons are unavailable while working.
  await expect(page.getByRole('button', { name: 'Start work' })).toHaveCount(0);

  // Completion reveals the rolled haul and the Mining XP gain.
  await page.waitForTimeout(13_000);
  await expect(page.getByText('Mine Copper Seam complete! You gained 8 Mining XP.')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(/(Copper Ore|Iron Ore) ×\d+/)).toBeVisible();
  await expect(page.getByText('8 / 20 XP', { exact: false })).toBeVisible();

  // The ore is in the pack.
  await nav.getByRole('link', { name: 'Inventory' }).click();
  await expect(page.getByText(/^(Copper Ore|Iron Ore)$/).first()).toBeVisible();
});
