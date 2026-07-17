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
  // A Vanguard: tough enough to brute-force the slime hollow at level 1.
  await page.getByRole('radio', { name: /Vanguard/ }).click();
  const name = `${tag} ${unique.slice(-6)}`;
  await page.getByLabel('Character name').fill(name);
  await page.getByRole('button', { name: 'Begin your journey' }).click();
  await expect(page).toHaveURL(/\/character$/);
  return { nav, name };
}

/** Test fixture: stands the character in Blackwood Forest (travel has its own spec). */
async function placeInBlackwood(characterName: string) {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const updated = await client.query(
      `UPDATE "Character" SET "currentLocationId" =
         (SELECT id FROM "Location" WHERE slug = 'blackwood-forest')
       WHERE name = $1`,
      [characterName],
    );
    expect(updated.rowCount).toBe(1);
  } finally {
    await client.end();
  }
}

test('a vanguard battles the slime hollow to victory', async ({ page }) => {
  test.setTimeout(120_000);
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  const { nav, name } = await registerAndCreate(page, 'Slayer', unique);
  await placeInBlackwood(name);
  await page.reload();

  // The dangerous forest offers its encounters, including the locked-free elite.
  await nav.getByRole('link', { name: 'Location' }).click();
  await expect(page.getByRole('heading', { name: 'Blackwood Forest' })).toBeVisible();
  await expect(page.getByText('Slime Hollow', { exact: true })).toBeVisible();
  await expect(page.getByText('The Ironhide Boar', { exact: true })).toBeVisible();

  // Start the slime fight.
  await page.getByRole('button', { name: 'Fight' }).first().click();
  await expect(page).toHaveURL(/\/combat\//);
  await expect(page.getByText('battle is joined', { exact: false })).toBeVisible();
  await expect(page.getByText('Forest Slime A')).toBeVisible();
  await expect(page.getByText('Forest Slime B')).toBeVisible();

  // Refresh persistence: reload restores the same battle, mid-fight.
  await page.reload();
  await expect(page.getByText('Forest Slime A')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attack' })).toBeVisible();

  // Attack until victory (two slimes at 26 HP fall in a handful of blows).
  const enemySection = page.getByRole('region', { name: 'Enemies' });
  for (let round = 0; round < 14; round++) {
    if (await page.getByRole('heading', { name: 'Victory!' }).isVisible()) break;
    await page.getByRole('button', { name: 'Attack' }).click();
    await expect(page.getByText('Choose a target')).toBeVisible();
    await enemySection.locator('button:not([disabled])').first().click();
    // Wait for the command to resolve: back to the main menu or the end card.
    await expect(
      page
        .getByRole('button', { name: 'Attack' })
        .or(page.getByRole('heading', { name: 'Victory!' }))
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  }

  await expect(page.getByRole('heading', { name: 'Victory!' })).toBeVisible();
  await expect(page.getByText('You gained 18 XP', { exact: false })).toBeVisible();

  // The character page reflects the spoils.
  await page.getByRole('link', { name: 'Return to your surroundings' }).click();
  await nav.getByRole('link', { name: 'Character' }).click();
  await expect(page.getByText('18 / 100 XP', { exact: false })).toBeVisible();
});
