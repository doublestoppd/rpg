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
 * Test fixture: stands the character at the Market District forge with
 * smelting materials already in the pack. Travel and shopping have their own
 * specs — this one is about crafting.
 */
async function stockSmithAtForge(characterName: string) {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const moved = await client.query(
      `UPDATE "Character" SET "currentLocationId" =
         (SELECT id FROM "Location" WHERE slug = 'crownfall-market-district')
       WHERE name = $1 RETURNING id`,
      [characterName],
    );
    expect(moved.rowCount).toBe(1);
    const characterId = (moved.rows[0] as { id: string }).id;
    for (const [slug, quantity] of [
      ['copper-ore', 6],
      ['forge-coal', 2],
    ] as const) {
      await client.query(
        `INSERT INTO "InventoryStack" ("id", "characterId", "itemDefinitionId", "quantity", "updatedAt")
         VALUES (gen_random_uuid(), $1, (SELECT id FROM "ItemDefinition" WHERE slug = $2), $3, now())`,
        [characterId, slug, quantity],
      );
    }
  } finally {
    await client.end();
  }
}

test('a smith smelts a copper ingot at the Crownfall Forge', async ({ page }) => {
  test.setTimeout(90_000); // includes one 12s timed crafting run
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  const { nav, name } = await registerAndCreate(page, 'Smith', unique);
  await stockSmithAtForge(name);
  await page.reload(); // drop client caches from before the fixture

  // The Market District page offers the working forge with three recipes.
  await nav.getByRole('link', { name: 'Location' }).click();
  await expect(page.getByRole('heading', { name: 'Crownfall Market District' })).toBeVisible();
  await expect(page.getByText('Blacksmithing level 1', { exact: false })).toBeVisible();
  await expect(page.getByText('Smelt Copper Ingot', { exact: true })).toBeVisible();
  await expect(page.getByText('Smelt Iron Ingot', { exact: true })).toBeVisible();
  await expect(page.getByText('Forge Bronze Longblade', { exact: true })).toBeVisible();
  // Higher recipes are visibly locked at Blacksmithing level 1.
  await expect(page.getByText('Requires Blacksmithing level 2')).toBeVisible();
  await expect(page.getByText('Requires Blacksmithing level 3')).toBeVisible();
  // The recipe card shows requirements against the pack.
  await expect(page.getByText('3× Copper Ore (have 6)', { exact: false })).toBeVisible();

  // Start smelting: inputs and the 2 Gold fee are consumed at start.
  await page.getByRole('button', { name: 'Begin crafting' }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();

  // A refresh mid-run changes nothing: still working, nothing granted.
  await page.reload();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Begin crafting' })).toHaveCount(0);

  // Completion grants the deterministic output and Blacksmithing XP.
  await page.waitForTimeout(13_000);
  await expect(
    page.getByText('Smelt Copper Ingot complete! You gained 10 Blacksmithing XP.'),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Copper Ingot ×1')).toBeVisible();
  await expect(page.getByText('10 / 25 XP', { exact: false })).toBeVisible();

  // The ingot is in the pack; the consumed ore went down.
  await nav.getByRole('link', { name: 'Inventory' }).click();
  await expect(page.getByText('Copper Ingot', { exact: true })).toBeVisible();
});
