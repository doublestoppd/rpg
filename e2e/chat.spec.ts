import { expect, type Page, test } from '@playwright/test';

async function registerAndCreate(page: Page, tag: string, unique: string) {
  await page.goto('/register');
  await page.getByLabel('Email').fill(`${tag}-${unique}@example.com`);
  await page.getByLabel('Display name').fill(`${tag}${unique.slice(-8)}`);
  await page.getByLabel('Password').fill('a sturdy passphrase 42');
  await page.getByRole('button', { name: 'Create account' }).click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Character' }).click();
  await page.getByRole('radio', { name: /Vanguard/ }).click();
  await page.getByLabel('Character name').fill(`${tag} ${unique.slice(-6)}`);
  await page.getByRole('button', { name: 'Begin your journey' }).click();
  await expect(page).toHaveURL(/\/character$/);
  return { nav };
}

async function sendChat(page: Page, text: string) {
  await page.getByPlaceholder('Type a message…').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByPlaceholder('Type a message…')).toHaveValue('');
}

test('two players chat globally and locally, then travel, block, and report', async ({
  browser,
}) => {
  test.setTimeout(150_000); // includes a 30s journey
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  const contextA = await browser.newContext();
  // Player B runs with WebSockets disabled to prove polling recovers messages.
  const contextB = await browser.newContext();
  await contextB.addInitScript(() => {
    // @ts-expect-error deliberately break the live socket for this context
    window.WebSocket = undefined;
  });
  const alice = await contextA.newPage();
  const bob = await contextB.newPage();

  const a = await registerAndCreate(alice, 'Alice', unique);
  const b = await registerAndCreate(bob, 'Bob', `${unique}b`);

  // Both open Chat (both start at Crownfall City).
  await a.nav.getByRole('link', { name: 'Chat' }).click();
  await b.nav.getByRole('link', { name: 'Chat' }).click();
  await expect(alice.getByRole('tab', { name: /Global/ })).toBeVisible();

  // Global chat is shared and persistent across the whole world (and across
  // e2e runs), so every message body carries the run's unique token.
  const aliceGlobal = `Alice global ${unique}`;
  const bobGlobal = `Bob global ${unique}`;
  const aliceLocal = `Alice local ${unique}`;
  const aliceMarket = `Alice market ${unique}`;

  // Alice sends a global message; Bob (no WebSocket) receives it via polling.
  // Bringing Bob's page to front makes its document visible so the polling
  // interval resumes (React Query pauses refetch on backgrounded tabs).
  await sendChat(alice, aliceGlobal);
  await bob.bringToFront();
  await expect(bob.getByText(aliceGlobal)).toBeVisible({ timeout: 30_000 });
  // Bob shows the polling-fallback state (no live socket).
  await expect(bob.getByText(/messages refresh automatically/)).toBeVisible();

  // Bob replies on global; Alice sees it.
  await sendChat(bob, bobGlobal);
  await alice.bringToFront();
  await expect(alice.getByText(bobGlobal)).toBeVisible({ timeout: 30_000 });

  // Both switch to Current Location (both in Crownfall City) and chat locally.
  await alice.getByRole('tab', { name: /Current Location/ }).click();
  await bob.bringToFront();
  await bob.getByRole('tab', { name: /Current Location/ }).click();
  await alice.bringToFront();
  await sendChat(alice, aliceLocal);
  await bob.bringToFront();
  await expect(bob.getByText(aliceLocal)).toBeVisible({ timeout: 30_000 });

  // Bob blocks Alice: her messages vanish from his view immediately.
  const aliceLocalRow = bob.getByRole('listitem').filter({ hasText: aliceLocal });
  await aliceLocalRow.getByRole('button', { name: 'Block' }).click();
  await expect(bob.getByText(aliceLocal)).toHaveCount(0);

  // Reporting: Alice reports Bob's global message (she has not blocked him).
  await alice.bringToFront();
  await alice.getByRole('tab', { name: /Global/ }).click();
  const bobGlobalRow = alice.getByRole('listitem').filter({ hasText: bobGlobal });
  await bobGlobalRow.getByRole('button', { name: 'Report' }).click();
  await alice.getByRole('dialog').getByRole('button', { name: 'Submit report' }).click();
  await expect(alice.getByText(/Report submitted/)).toBeVisible();

  // Alice travels away: she loses Crownfall City local access.
  await a.nav.getByRole('link', { name: 'Location' }).click();
  const aliceRoads = alice.getByRole('region', { name: 'Roads from here' });
  await expect(aliceRoads.getByText('Crownfall Market District', { exact: true })).toBeVisible();
  await aliceRoads.getByRole('button', { name: 'Set out' }).first().click();
  await expect(alice.getByRole('progressbar').first()).toBeVisible();

  // While traveling, only Global is available (no location tab).
  await a.nav.getByRole('link', { name: 'Chat' }).click();
  await expect(alice.getByRole('tab', { name: /Current Location/ })).toHaveCount(0);
  await expect(alice.getByRole('tab', { name: /Global/ })).toBeVisible();

  // After arrival, the location tab reflects the destination, not the origin.
  await alice.waitForTimeout(32_000);
  await a.nav.getByRole('link', { name: 'Location' }).click();
  await alice.reload(); // finalize arrival
  await a.nav.getByRole('link', { name: 'Chat' }).click();
  await alice.getByRole('tab', { name: /Current Location/ }).click();
  await sendChat(alice, aliceMarket);
  // Bob, still in Crownfall City, never sees the Market District local message.
  await bob.bringToFront();
  await bob.reload();
  await bob.getByRole('tab', { name: /Current Location/ }).click();
  await expect(bob.getByText(aliceMarket)).toHaveCount(0);

  // Bob's global history survives a reload (persistent, authoritative).
  await bob.getByRole('tab', { name: /Global/ }).click();
  await expect(bob.getByText(bobGlobal)).toBeVisible();

  await contextA.close();
  await contextB.close();
});
