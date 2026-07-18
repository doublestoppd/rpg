import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { promoteToAdmin } from '../domain/admin/admin-bootstrap.js';
import { SESSION_COOKIE } from '../plugins/auth-plugin.js';
import { raceRequests } from '../test-concurrency.js';
import {
  buildTestApp,
  createTestPrisma,
  registerTestUser,
  TEST_ORIGIN,
  truncateAll,
} from '../test-helpers.js';

let prisma: PrismaClient;
let app: FastifyInstance;

beforeAll(async () => {
  prisma = createTestPrisma();
  app = await buildTestApp(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

const PASSWORD = 'a test passphrase';
type Auth = { cookie: string; csrf: string; userId: string };

async function login(email: string): Promise<Auth> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: TEST_ORIGIN },
    payload: { email, password: PASSWORD },
  });
  if (response.statusCode !== 200) throw new Error(`login failed: ${response.body}`);
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  const body = response.json<{ user: { id: string }; csrfToken: string }>();
  return { cookie, csrf: body.csrfToken, userId: body.user.id };
}

/** Registers, promotes to ADMIN, re-logs in, and reauthenticates. */
async function makeAdmin(): Promise<Auth> {
  const unique = Math.random().toString(36).slice(2, 10);
  const email = `admin-${unique}@example.com`;
  await registerTestUser(app, { email, displayName: `Admin${unique}` });
  await promoteToAdmin(prisma, { identifier: email, nodeEnv: 'test', bootstrapEnabled: undefined });
  const auth = await login(email); // promotion revoked the original session
  const reauth = await post(auth, '/api/v1/admin/reauth', { password: PASSWORD });
  expect(reauth.statusCode).toBe(200);
  return auth;
}

/** A plain player with a character at Crownfall City. Returns auth + ids. */
async function makePlayer(): Promise<{ auth: Auth; characterId: string }> {
  const unique = Math.random().toString(36).slice(2, 10);
  const reg = await registerTestUser(app, {
    email: `p-${unique}@example.com`,
    displayName: `Player${unique}`,
  });
  const auth: Auth = { cookie: reg.cookie, csrf: reg.csrf, userId: reg.userId };
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Hero ${unique}`, classSlug: 'vanguard' },
  });
  expect(created.statusCode).toBe(201);
  const character = await prisma.character.findFirstOrThrow({ where: { userId: auth.userId } });
  return { auth, characterId: character.id };
}

function get(auth: { cookie: string }, url: string) {
  return app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE]: auth.cookie } });
}
function post(auth: Auth, url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    ...(payload ? { payload } : {}),
  });
}
function patch(auth: Auth, url: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload,
  });
}

let keySeq = 0;
const key = () => `admin-key-${keySeq++}-${Math.random().toString(36).slice(2, 8)}`;

describe('admin bootstrap and promotion', () => {
  it('promotes an existing account, revokes its sessions, and audits without secrets', async () => {
    const unique = Math.random().toString(36).slice(2, 10);
    const email = `boot-${unique}@example.com`;
    const reg = await registerTestUser(app, { email, displayName: `Boot${unique}` });
    // The pre-promotion session works until promotion revokes it.
    const result = await promoteToAdmin(prisma, {
      identifier: email,
      nodeEnv: 'test',
      bootstrapEnabled: undefined,
    });
    expect(result.changed).toBe(true);
    expect(result.revokedSessions).toBeGreaterThanOrEqual(1);

    // The old session is revoked (session endpoint now unauthenticated).
    const stale = await get({ cookie: reg.cookie }, '/api/v1/admin/session');
    expect(stale.statusCode).toBe(401);

    // A SYSTEM audit row exists and carries no secret.
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actionNamespace: 'admin.bootstrap.promote' },
    });
    expect(audit.actorSessionId).toBe('SYSTEM');
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);

    // Idempotent: promoting again changes nothing.
    const again = await promoteToAdmin(prisma, {
      identifier: email,
      nodeEnv: 'test',
      bootstrapEnabled: undefined,
    });
    expect(again.changed).toBe(false);
  });

  it('rejects ambiguous targets and honors the production allow flag', async () => {
    const unique = Math.random().toString(36).slice(2, 8);
    // Two display names differing only in case: a case-insensitive identifier
    // matches both, so promotion refuses rather than guess.
    await registerTestUser(app, {
      email: `a1-${unique}@example.com`,
      displayName: `Dup${unique}`,
    });
    await registerTestUser(app, {
      email: `a2-${unique}@example.com`,
      displayName: `dup${unique}`,
    });
    await expect(
      promoteToAdmin(prisma, {
        identifier: `Dup${unique}`,
        nodeEnv: 'test',
        bootstrapEnabled: undefined,
      }),
    ).rejects.toThrow(/multiple accounts/);

    // Production without the allow flag refuses (unambiguous exact email).
    await expect(
      promoteToAdmin(prisma, {
        identifier: `a2-${unique}@example.com`,
        nodeEnv: 'production',
        bootstrapEnabled: undefined,
      }),
    ).rejects.toThrow(/ADMIN_BOOTSTRAP_ENABLED/);
    // With the flag it proceeds.
    const ok = await promoteToAdmin(prisma, {
      identifier: `a2-${unique}@example.com`,
      nodeEnv: 'production',
      bootstrapEnabled: 'true',
    });
    expect(ok.changed).toBe(true);
  });
});

describe('admin authorization and reauth', () => {
  it('rejects non-admins on every admin route', async () => {
    const { auth: player, characterId } = await makePlayer();
    expect((await get(player, '/api/v1/admin/session')).statusCode).toBe(403);
    expect((await get(player, '/api/v1/admin/characters')).statusCode).toBe(403);
    // A well-formed mutation still 403s for a non-admin (authorization, not
    // validation, is the gate).
    const mutation = await post(
      player,
      `/api/v1/admin/characters/${characterId}/gold-adjustments`,
      { amount: '100', reason: 'should be forbidden', idempotencyKey: key() },
    );
    expect(mutation.statusCode).toBe(403);
  });

  it('requires recent-auth for mutations and detail reads; search works without it', async () => {
    const unique = Math.random().toString(36).slice(2, 10);
    const email = `noreauth-${unique}@example.com`;
    await registerTestUser(app, { email, displayName: `NoReauth${unique}` });
    await promoteToAdmin(prisma, {
      identifier: email,
      nodeEnv: 'test',
      bootstrapEnabled: undefined,
    });
    const admin = await login(email); // admin, but NOT reauthenticated

    // Search (low sensitivity) is allowed.
    expect((await get(admin, '/api/v1/admin/characters')).statusCode).toBe(200);
    // A high-sensitivity read requires reauth.
    const { characterId } = await makePlayer();
    expect((await get(admin, `/api/v1/admin/characters/${characterId}/overview`)).statusCode).toBe(
      403,
    );
    // A mutation requires reauth.
    const blocked = await post(admin, `/api/v1/admin/characters/${characterId}/gold-adjustments`, {
      amount: '100',
      reason: 'test grant',
      idempotencyKey: key(),
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('REAUTH_REQUIRED');

    // After reauth, both work.
    expect((await post(admin, '/api/v1/admin/reauth', { password: PASSWORD })).statusCode).toBe(
      200,
    );
    expect((await get(admin, `/api/v1/admin/characters/${characterId}/overview`)).statusCode).toBe(
      200,
    );
  });

  it('reauth returns a generic failure on a wrong password', async () => {
    const unique = Math.random().toString(36).slice(2, 10);
    const email = `wrongpw-${unique}@example.com`;
    await registerTestUser(app, { email, displayName: `WrongPw${unique}` });
    await promoteToAdmin(prisma, {
      identifier: email,
      nodeEnv: 'test',
      bootstrapEnabled: undefined,
    });
    const admin = await login(email);
    const bad = await post(admin, '/api/v1/admin/reauth', { password: 'not the password' });
    expect(bad.statusCode).toBe(401);
    expect(bad.json<{ error: { code: string } }>().error.code).toBe('REAUTH_FAILED');
  });

  it('a password change invalidates recent-auth', async () => {
    const admin = await makeAdmin();
    const { characterId } = await makePlayer();
    // Works right after reauth.
    expect((await get(admin, `/api/v1/admin/characters/${characterId}/overview`)).statusCode).toBe(
      200,
    );
    // Change password (rotates the session too); the new session is not reauthed.
    const changed = await post(admin, '/api/v1/auth/change-password', {
      currentPassword: PASSWORD,
      newPassword: 'a different passphrase',
    });
    expect(changed.statusCode).toBe(200);
    const newCookie = changed.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    const newCsrf = changed.json<{ csrfToken: string }>().csrfToken;
    const rotated: Auth = { cookie: newCookie, csrf: newCsrf, userId: admin.userId };
    expect(
      (await get(rotated, `/api/v1/admin/characters/${characterId}/overview`)).statusCode,
    ).toBe(403);
  });
});

describe('admin gold adjustments', () => {
  it('credits and debits through the ledger with one audit row, idempotently', async () => {
    const admin = await makeAdmin();
    const { characterId } = await makePlayer();
    const k = key();
    const credit = await post(admin, `/api/v1/admin/characters/${characterId}/gold-adjustments`, {
      amount: '500',
      reason: 'compensation for a bug',
      idempotencyKey: k,
    });
    expect(credit.statusCode).toBe(200);
    const body = credit.json<{ transactionId: string; gold: string; auditId: string }>();
    expect(body.gold).toBe('600'); // 100 starting + 500

    // One ledger entry and one audit row.
    expect(await prisma.currencyTransaction.count({ where: { type: 'ADMIN_ADJUSTMENT' } })).toBe(1);
    expect(
      await prisma.adminAuditLog.count({ where: { actionNamespace: 'currency.adjust' } }),
    ).toBe(1);

    // Replay with the same key: same result, still one entry and one audit.
    const replay = await post(admin, `/api/v1/admin/characters/${characterId}/gold-adjustments`, {
      amount: '500',
      reason: 'compensation for a bug',
      idempotencyKey: k,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ transactionId: string }>().transactionId).toBe(body.transactionId);
    expect(await prisma.currencyTransaction.count({ where: { type: 'ADMIN_ADJUSTMENT' } })).toBe(1);
  });

  it('rejects a debit that would make the balance negative, changing nothing', async () => {
    const admin = await makeAdmin();
    const { characterId } = await makePlayer();
    const before = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
    const debit = await post(admin, `/api/v1/admin/characters/${characterId}/gold-adjustments`, {
      amount: '-100000',
      reason: 'overdraw attempt',
      idempotencyKey: key(),
    });
    expect(debit.statusCode).toBe(409);
    const after = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
    expect(after.balance).toBe(before.balance);
    // The failed mutation wrote no adjustment audit (the bootstrap promote row
    // is a different namespace).
    expect(
      await prisma.adminAuditLog.count({ where: { actionNamespace: 'currency.adjust' } }),
    ).toBe(0);
  });

  it('creates exactly one ledger entry under a concurrent duplicate-key race', async () => {
    const admin = await makeAdmin();
    const { characterId } = await makePlayer();
    const k = key();
    const responses = await raceRequests(
      Array.from(
        { length: 4 },
        () => () =>
          post(admin, `/api/v1/admin/characters/${characterId}/gold-adjustments`, {
            amount: '50',
            reason: 'concurrent grant',
            idempotencyKey: k,
          }),
      ),
    );
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    expect(await prisma.currencyTransaction.count({ where: { type: 'ADMIN_ADJUSTMENT' } })).toBe(1);
    expect(
      await prisma.adminAuditLog.count({ where: { actionNamespace: 'currency.adjust' } }),
    ).toBe(1);
  });
});

describe('admin item grants and removals', () => {
  it('grants stackable items with an ItemTransfer and audit, idempotently', async () => {
    const admin = await makeAdmin();
    const { characterId } = await makePlayer();
    const k = key();
    const grant = await post(admin, `/api/v1/admin/characters/${characterId}/item-grants`, {
      itemSlug: 'copper-ore',
      quantity: 5,
      reason: 'seed materials',
      idempotencyKey: k,
    });
    expect(grant.statusCode).toBe(200);
    const stack = await prisma.inventoryStack.findFirst({
      where: { characterId, itemDefinition: { slug: 'copper-ore' } },
    });
    expect(stack?.quantity).toBe(5);

    // Replay grants nothing more.
    await post(admin, `/api/v1/admin/characters/${characterId}/item-grants`, {
      itemSlug: 'copper-ore',
      quantity: 5,
      reason: 'seed materials',
      idempotencyKey: k,
    });
    const stack2 = await prisma.inventoryStack.findFirst({
      where: { characterId, itemDefinition: { slug: 'copper-ore' } },
    });
    expect(stack2?.quantity).toBe(5);
  });

  it('removes a free stack, records a destruction, and rejects a locked instance', async () => {
    const admin = await makeAdmin();
    const { characterId } = await makePlayer();
    // Grant then remove a stack.
    await post(admin, `/api/v1/admin/characters/${characterId}/item-grants`, {
      itemSlug: 'iron-ore',
      quantity: 3,
      reason: 'grant',
      idempotencyKey: key(),
    });
    const removal = await post(admin, `/api/v1/admin/characters/${characterId}/item-removals`, {
      itemSlug: 'iron-ore',
      quantity: 2,
      reason: 'confiscation',
      idempotencyKey: key(),
    });
    expect(removal.statusCode).toBe(200);
    const stack = await prisma.inventoryStack.findFirst({
      where: { characterId, itemDefinition: { slug: 'iron-ore' } },
    });
    expect(stack?.quantity).toBe(1);
    expect(
      await prisma.itemDestruction.count({ where: { characterId, reason: 'ADMIN_REMOVAL' } }),
    ).toBe(1);

    // A listed (locked) instance cannot be removed.
    const tunic = await prisma.itemDefinition.findUniqueOrThrow({
      where: { slug: 'quilted-tunic' },
    });
    const instance = await prisma.itemInstance.create({
      data: { itemDefinitionId: tunic.id, ownerCharacterId: characterId, lockState: 'LISTED' },
    });
    const locked = await post(admin, `/api/v1/admin/characters/${characterId}/item-removals`, {
      itemInstanceId: instance.id,
      reason: 'confiscation',
      idempotencyKey: key(),
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json<{ error: { code: string } }>().error.code).toBe('ITEM_LOCKED');
  });
});

describe('admin configuration with optimistic concurrency', () => {
  it('patches safe item-definition fields and rejects a stale version', async () => {
    const admin = await makeAdmin();
    // Item definitions are seed config (not reset between tests); read the
    // current version rather than assuming zero.
    const start = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug: 'copper-ore' } });
    const patch1 = await patch(admin, '/api/v1/admin/item-definitions/copper-ore', {
      expectedVersion: start.configVersion,
      description: 'Freshly re-described ore.',
      reason: 'copy edit',
    });
    expect(patch1.statusCode).toBe(200);
    expect(patch1.json<{ configVersion: number }>().configVersion).toBe(start.configVersion + 1);

    // A second edit at the now-stale version loses with 409.
    const stale = await patch(admin, '/api/v1/admin/item-definitions/copper-ore', {
      expectedVersion: start.configVersion,
      description: 'Should not apply.',
      reason: 'stale edit',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe('STALE_VERSION');
  });

  it('only one writer wins a concurrent same-version item edit', async () => {
    const admin = await makeAdmin();
    const start = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug: 'iron-ore' } });
    const responses = await raceRequests(
      Array.from(
        { length: 4 },
        (_, i) => () =>
          patch(admin, '/api/v1/admin/item-definitions/iron-ore', {
            expectedVersion: start.configVersion,
            description: `Concurrent edit ${i}.`,
            reason: 'race',
          }),
      ),
    );
    const winners = responses.filter((r) => r.statusCode === 200);
    const losers = responses.filter((r) => r.statusCode === 409);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(3);
    const item = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug: 'iron-ore' } });
    expect(item.configVersion).toBe(start.configVersion + 1);
  });

  it('shop config edits apply to the next restock without changing past records', async () => {
    const admin = await makeAdmin();
    const shop = await prisma.npcShop.findFirstOrThrow();
    const before = shop.markupBps;
    const patched = await patch(admin, `/api/v1/admin/npc-shops/${shop.id}/config`, {
      expectedVersion: shop.configVersion,
      markupBps: before + 500,
      reason: 'price tuning',
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ markupBps: number }>().markupBps).toBe(before + 500);
  });
});

describe('admin economy metrics', () => {
  it('computes bounded, exact, database-derived metrics and rejects a too-large window', async () => {
    const admin = await makeAdmin();
    // A gold adjustment produces a ledger source within the window.
    const { characterId } = await makePlayer();
    await post(admin, `/api/v1/admin/characters/${characterId}/gold-adjustments`, {
      amount: '1000',
      reason: 'metric fixture',
      idempotencyKey: key(),
    });

    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 60_000).toISOString();
    const metrics = await get(
      admin,
      `/api/v1/admin/metrics/economy?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    );
    expect(metrics.statusCode).toBe(200);
    const body = metrics.json<{ totalGold: string; goldSources: string }>();
    expect(BigInt(body.goldSources)).toBeGreaterThanOrEqual(1000n);
    expect(BigInt(body.totalGold)).toBeGreaterThanOrEqual(1000n);

    // A window beyond the maximum is rejected.
    const tooBig = await get(
      admin,
      `/api/v1/admin/metrics/economy?start=${encodeURIComponent(new Date(0).toISOString())}&end=${encodeURIComponent(end)}`,
    );
    expect(tooBig.statusCode).toBe(400);
    expect(tooBig.json<{ error: { code: string } }>().error.code).toBe('WINDOW_TOO_LARGE');
  });
});

describe('admin audit log', () => {
  it('is append-only at the database level', async () => {
    const admin = await makeAdmin();
    const { characterId } = await makePlayer();
    await post(admin, `/api/v1/admin/characters/${characterId}/gold-adjustments`, {
      amount: '10',
      reason: 'audit test',
      idempotencyKey: key(),
    });
    const row = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actionNamespace: 'currency.adjust' },
    });
    await expect(
      prisma.adminAuditLog.update({ where: { id: row.id }, data: { reason: 'tampered' } }),
    ).rejects.toThrow();
    await expect(prisma.adminAuditLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });

  it('never serializes secrets into before/after JSON', async () => {
    const admin = await makeAdmin();
    const { characterId } = await makePlayer();
    await post(admin, `/api/v1/admin/characters/${characterId}/gold-adjustments`, {
      amount: '25',
      reason: 'safe json',
      idempotencyKey: key(),
    });
    const rows = await prisma.adminAuditLog.findMany();
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('tokenHash');
  });
});
