import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { promoteToAdmin } from '../domain/admin/admin-bootstrap.js';
import { REDACTION_TOMBSTONE } from '../domain/admin/admin-moderation.js';
import { SESSION_COOKIE } from '../plugins/auth-plugin.js';
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
async function login(email: string): Promise<Auth> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: TEST_ORIGIN },
    payload: { email, password: PASSWORD },
  });
  const cookie = r.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  const body = r.json<{ user: { id: string }; csrfToken: string }>();
  return { cookie, csrf: body.csrfToken, userId: body.user.id };
}
async function makeAdmin(): Promise<Auth> {
  const unique = Math.random().toString(36).slice(2, 10);
  const email = `mod-${unique}@example.com`;
  await registerTestUser(app, { email, displayName: `Mod${unique}` });
  await promoteToAdmin(prisma, { identifier: email, nodeEnv: 'test', bootstrapEnabled: undefined });
  const auth = await login(email);
  await post(auth, '/api/v1/admin/reauth', { password: PASSWORD });
  return auth;
}
async function makePlayer(): Promise<{ auth: Auth; characterId: string }> {
  const unique = Math.random().toString(36).slice(2, 10);
  const reg = await registerTestUser(app, {
    email: `pl-${unique}@example.com`,
    displayName: `Pl${unique}`,
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
  await prisma.character.update({
    where: { id: character.id },
    data: { currentLocationId: (await prisma.location.findFirstOrThrow()).id },
  });
  return { auth, characterId: character.id };
}

let seq = 0;
const key = () => `mod-key-${seq++}-${Math.random().toString(36).slice(2, 8)}`;

async function globalChannelId(auth: Auth): Promise<string> {
  const r = await get(auth, '/api/v1/chat/channels');
  return r
    .json<{ channels: Array<{ id: string; kind: string }> }>()
    .channels.find((c) => c.kind === 'GLOBAL')!.id;
}

/** A player sends a message; another reports it. Returns ids. */
async function reportedMessage() {
  const author = await makePlayer();
  const reporter = await makePlayer();
  const channelId = await globalChannelId(author.auth);
  const sent = await post(author.auth, `/api/v1/chat/channels/${channelId}/messages`, {
    body: 'a rude message',
    idempotencyKey: key(),
  });
  const messageId = sent.json<{ message: { id: string } }>().message.id;
  const reported = await post(reporter.auth, `/api/v1/chat/messages/${messageId}/reports`, {
    reason: 'HARASSMENT',
    details: 'evidence note for the moderator',
  });
  expect(reported.statusCode).toBe(201);
  const report = await prisma.chatReport.findFirstOrThrow({ where: { messageId } });
  return { author, reporter, messageId, reportId: report.id, channelId };
}

describe('admin report triage and privacy', () => {
  it('lists reports with evidence but never the reporter identity', async () => {
    const admin = await makeAdmin();
    const { reporter } = await reportedMessage();
    const list = await get(admin, '/api/v1/admin/chat/reports');
    expect(list.statusCode).toBe(200);
    const body = list.body;
    // Evidence (message snapshot + the reporter's note) is present for triage…
    expect(body).toContain('a rude message');
    expect(body).toContain('evidence note for the moderator');
    // …but the reporter's identity is never exposed, even to the admin.
    expect(body).not.toContain(reporter.characterId);
  });

  it('resolves a report once, preserving evidence, and is idempotent', async () => {
    const admin = await makeAdmin();
    const { reportId, messageId } = await reportedMessage();
    const resolve = await post(admin, `/api/v1/admin/chat/reports/${reportId}/resolve`, {
      resolution: 'RESOLVED',
      reason: 'action taken',
      idempotencyKey: key(),
    });
    expect(resolve.statusCode).toBe(200);
    const report = await prisma.chatReport.findUniqueOrThrow({ where: { id: reportId } });
    expect(report.status).toBe('RESOLVED');
    // The immutable evidence snapshot survives resolution.
    expect(report.snapshotBody).toBe('a rude message');
    // A second resolve of the same OPEN→done transition is a conflict.
    const again = await post(admin, `/api/v1/admin/chat/reports/${reportId}/resolve`, {
      resolution: 'DISMISSED',
      reason: 'changed my mind',
      idempotencyKey: key(),
    });
    expect(again.statusCode).toBe(409);
    void messageId;
  });
});

describe('admin message redaction', () => {
  it('redacts to a tombstone, preserving id/author/ordering and report evidence', async () => {
    const admin = await makeAdmin();
    const { messageId, reportId } = await reportedMessage();
    const before = await prisma.chatMessage.findUniqueOrThrow({ where: { id: messageId } });

    const redact = await post(admin, `/api/v1/admin/chat/messages/${messageId}/redact`, {
      reason: 'abusive content',
      idempotencyKey: key(),
    });
    expect(redact.statusCode).toBe(200);

    const after = await prisma.chatMessage.findUniqueOrThrow({ where: { id: messageId } });
    // Tombstone body, same row, author, channel, and creation time.
    expect(after.body).toBe(REDACTION_TOMBSTONE);
    expect(after.redactedAt).not.toBeNull();
    expect(after.authorCharacterId).toBe(before.authorCharacterId);
    expect(after.channelId).toBe(before.channelId);
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
    // Report evidence snapshot is untouched (still the original text).
    const report = await prisma.chatReport.findUniqueOrThrow({ where: { id: reportId } });
    expect(report.snapshotBody).toBe('a rude message');
    // The message row is never hard-deleted.
    expect(await prisma.chatMessage.count({ where: { id: messageId } })).toBe(1);

    // A moderation action record exists.
    expect(
      await prisma.chatModerationAction.count({ where: { action: 'REDACT_MESSAGE', messageId } }),
    ).toBe(1);
  });
});

describe('admin restrictions', () => {
  it('applies a restriction that the send service enforces immediately, then revokes it', async () => {
    const admin = await makeAdmin();
    const { auth: player, characterId } = await makePlayer();
    const channelId = await globalChannelId(player);
    // Sends fine before any restriction.
    expect(
      (
        await post(player, `/api/v1/chat/channels/${channelId}/messages`, {
          body: 'hello',
          idempotencyKey: key(),
        })
      ).statusCode,
    ).toBe(201);

    // Admin restricts the player.
    const applied = await post(admin, '/api/v1/admin/chat/restrictions', {
      characterId,
      reason: 'spamming',
      idempotencyKey: key(),
    });
    expect(applied.statusCode).toBe(200);
    const restrictionId = applied.json<{ restrictionId: string }>().restrictionId;

    // The send service now blocks the player (immediate enforcement).
    const blocked = await post(player, `/api/v1/chat/channels/${channelId}/messages`, {
      body: 'let me talk',
      idempotencyKey: key(),
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('CHAT_RESTRICTED');

    // Revoke: history preserved, sending restored.
    const revoke = await post(admin, `/api/v1/admin/chat/restrictions/${restrictionId}/revoke`, {
      reason: 'appeal granted',
      idempotencyKey: key(),
    });
    expect(revoke.statusCode).toBe(200);
    const restriction = await prisma.chatRestriction.findUniqueOrThrow({
      where: { id: restrictionId },
    });
    expect(restriction.status).toBe('REVOKED');
    expect(
      (
        await post(player, `/api/v1/chat/channels/${channelId}/messages`, {
          body: 'thanks',
          idempotencyKey: key(),
        })
      ).statusCode,
    ).toBe(201);
  });
});
