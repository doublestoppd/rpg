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

/** Test fixture: hands the character a Sunken Crown Fragment (artifacts
 * only drop rarely in the wild; acquisition has its own systems). */
async function grantCrownFragment(characterName: string) {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const inserted = await client.query(
      `INSERT INTO "ItemInstance" ("id", "itemDefinitionId", "ownerCharacterId")
       SELECT gen_random_uuid(), i.id, c.id
       FROM "ItemDefinition" i, "Character" c
       WHERE i.slug = 'sunken-crown-fragment' AND c.name = $1
       RETURNING "id"`,
      [characterName],
    );
    expect(inserted.rowCount).toBe(1);
  } finally {
    await client.end();
  }
}

test('a patron donates the crown fragment: permanent display + quest completion', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  const { nav, name } = await registerAndCreate(page, 'Patron', unique);
  await grantCrownFragment(name);
  await page.reload(); // drop client caches from before the fixture

  // Accept the museum quest first, so the donation completes it atomically.
  await nav.getByRole('link', { name: 'Quests' }).click();
  const museumQuest = page
    .locator('div')
    .filter({ has: page.getByText('A Gift for the Museum', { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Accept quest' }) })
    .last();
  await museumQuest.getByRole('button', { name: 'Accept quest' }).click();
  await expect(page.getByText('In progress').first()).toBeVisible();

  // The Crownfall City museum lists the collection with our carried artifact.
  await nav.getByRole('link', { name: 'Location' }).click();
  await expect(page.getByRole('heading', { name: 'Crownfall City' })).toBeVisible();
  await expect(page.getByText('Regional Artifacts: 0/3 donated')).toBeVisible();
  await expect(page.getByText('You carry 1', { exact: true })).toBeVisible();

  // Donation asks for confirmation — it is permanent.
  await page.getByRole('button', { name: 'Donate', exact: true }).click();
  await expect(page.getByText('Donations are permanent.')).toBeVisible();
  await page.getByRole('button', { name: 'Donate forever' }).click();
  await expect(
    page.getByText('The curators accept your Sunken Crown Fragment with thanks.'),
  ).toBeVisible();
  await expect(page.getByText('Regional Artifacts: 1/3 donated')).toBeVisible();
  await expect(page.getByText('On display', { exact: true })).toBeVisible();
  await expect(page.getByText('royal barge', { exact: false })).toBeVisible();

  // The collection page shows the revealed entry and hides the others.
  await nav.getByRole('link', { name: 'Collection' }).click();
  await expect(page.getByText('Regional Artifacts — 1/3')).toBeVisible();
  await expect(page.getByText('Sunken Crown Fragment', { exact: true })).toBeVisible();
  await expect(page.getByText('??? — an undonated artifact').first()).toBeVisible();

  // The quest completed in the same transaction; claim its reward.
  await nav.getByRole('link', { name: 'Quests' }).click();
  await expect(page.getByText('Complete — claim your reward')).toBeVisible();
  await page.getByRole('button', { name: 'Claim reward' }).click();
  await expect(page.getByText('Reward claimed: 80 XP, 50 Gold.')).toBeVisible();

  // The artifact is gone from the pack — donations are irreversible.
  await nav.getByRole('link', { name: 'Inventory' }).click();
  await expect(page.getByText('Sunken Crown Fragment')).toHaveCount(0);
});
