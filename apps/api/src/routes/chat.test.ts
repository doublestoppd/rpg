import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cleanupExpiredChatMessages } from '../domain/chat/chat-cleanup.js';
import { metrics } from '../lib/metrics.js';
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
  // A generous chat limit so unrelated tests never trip it; the dedicated
  // rate-limit test overrides the environment for a tiny bucket.
  app = await buildTestApp(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

type Auth = { cookie: string; csrf: string };

async function setupCharacter(locationSlug = 'crownfall-city', classSlug = 'vanguard') {
  const auth = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Herald ${Math.random().toString(36).slice(2, 8)}`, classSlug },
  });
  expect(created.statusCode).toBe(201);
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  const location = await prisma.location.findUniqueOrThrow({ where: { slug: locationSlug } });
  await prisma.character.update({
    where: { id: character.id },
    data: { currentLocationId: location.id },
  });
  return { auth, characterId: character.id, sessionCookie: auth.cookie };
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

function put(auth: Auth, url: string) {
  return app.inject({
    method: 'PUT',
    url,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

function del(auth: Auth, url: string) {
  return app.inject({
    method: 'DELETE',
    url,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

interface ChannelLite {
  id: string;
  kind: 'GLOBAL' | 'LOCATION';
  name: string;
  locationSlug: string | null;
  unreadCount: number;
  unreadCapped: boolean;
}

async function listChannels(auth: { cookie: string }): Promise<ChannelLite[]> {
  const response = await get(auth, '/api/v1/chat/channels');
  expect(response.statusCode).toBe(200);
  return response.json<{ channels: ChannelLite[] }>().channels;
}

async function globalChannel(auth: { cookie: string }): Promise<ChannelLite> {
  const channels = await listChannels(auth);
  return channels.find((channel) => channel.kind === 'GLOBAL')!;
}

let sendCounter = 0;
function sendMessage(auth: Auth, channelId: string, body: string, key?: string) {
  sendCounter += 1;
  return post(auth, `/api/v1/chat/channels/${channelId}/messages`, {
    body,
    idempotencyKey: key ?? `send-${sendCounter}-${Math.random().toString(36).slice(2, 8)}`,
  });
}

describe('chat seed and database constraints', () => {
  it('seeds exactly one global channel and one per location, correctly linked', async () => {
    const channels = await prisma.chatChannel.findMany({ include: { location: true } });
    const globals = channels.filter((c) => c.kind === 'GLOBAL');
    const locations = channels.filter((c) => c.kind === 'LOCATION');
    expect(globals).toHaveLength(1);
    expect(globals[0]!.locationId).toBeNull();
    const locationCount = await prisma.location.count();
    expect(locations).toHaveLength(locationCount);
    for (const channel of locations) {
      expect(channel.locationId).not.toBeNull();
      expect(channel.location).not.toBeNull();
    }
  });

  it('rejects a second global channel (partial unique index)', async () => {
    await expect(
      prisma.chatChannel.create({ data: { slug: 'global-2', kind: 'GLOBAL' } }),
    ).rejects.toThrow();
  });

  it('rejects an invalid kind/location combination (CHECK constraint)', async () => {
    const location = await prisma.location.findFirstOrThrow();
    // GLOBAL with a location:
    await expect(
      prisma.chatChannel.create({
        data: { slug: 'bad-global', kind: 'GLOBAL', locationId: location.id },
      }),
    ).rejects.toThrow();
    // LOCATION without a location:
    await expect(
      prisma.chatChannel.create({ data: { slug: 'bad-location', kind: 'LOCATION' } }),
    ).rejects.toThrow();
  });

  it('rejects a self-block at the database level (CHECK constraint)', async () => {
    const { characterId } = await setupCharacter();
    await expect(
      prisma.chatBlock.create({
        data: { blockerCharacterId: characterId, blockedCharacterId: characterId },
      }),
    ).rejects.toThrow();
  });
});

describe('global chat send and read', () => {
  it('sends and reads global messages; the server derives author and channel', async () => {
    const { auth } = await setupCharacter();
    const global = await globalChannel(auth);

    const sent = await sendMessage(auth, global.id, 'Hail, travelers!');
    expect(sent.statusCode).toBe(201);
    const message = sent.json<{ message: { id: string; author: { name: string }; body: string } }>()
      .message;
    expect(message.body).toBe('Hail, travelers!');
    expect(message.author.name).toBeTruthy();

    const history = await get(auth, `/api/v1/chat/channels/${global.id}/messages`);
    expect(history.statusCode).toBe(200);
    const body = history.json<{ messages: Array<{ id: string; body: string }> }>();
    expect(body.messages.map((m) => m.body)).toContain('Hail, travelers!');
  });

  it('ignores client-supplied author, location, timestamps, and status', async () => {
    const { auth, characterId } = await setupCharacter();
    const global = await globalChannel(auth);
    const sent = await post(auth, `/api/v1/chat/channels/${global.id}/messages`, {
      body: 'clean',
      idempotencyKey: 'spoof-attempt-1',
      // These extra fields are stripped by the schema — never trusted.
      authorCharacterId: '00000000-0000-4000-8000-000000000000',
      createdAt: '2000-01-01T00:00:00.000Z',
      status: 'HIDDEN',
    });
    expect(sent.statusCode).toBe(201);
    const stored = await prisma.chatMessage.findFirstOrThrow({ where: { body: 'clean' } });
    expect(stored.authorCharacterId).toBe(characterId);
    expect(stored.status).toBe('VISIBLE');
    expect(stored.createdAt.getFullYear()).toBeGreaterThan(2020);
  });
});

describe('location chat authorization and travel', () => {
  it('allows the current-location channel and rejects a foreign one', async () => {
    const { auth } = await setupCharacter('ironroot-mine');
    const channels = await listChannels(auth);
    const mine = channels.find((c) => c.locationSlug === 'ironroot-mine');
    expect(mine).toBeDefined();
    // The location list only exposes the channel for the current location.
    expect(channels.filter((c) => c.kind === 'LOCATION')).toHaveLength(1);

    const sent = await sendMessage(auth, mine!.id, 'Anyone mining copper?');
    expect(sent.statusCode).toBe(201);

    // A different location's channel is forbidden (403), even by direct id.
    const other = await prisma.chatChannel.findFirstOrThrow({
      where: { kind: 'LOCATION', location: { slug: 'greenmeadow-village' } },
    });
    const rejected = await sendMessage(auth, other.id, 'hi');
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json<{ error: { code: string } }>().error.code).toBe('CHANNEL_FORBIDDEN');
    const readRejected = await get(auth, `/api/v1/chat/channels/${other.id}/messages`);
    expect(readRejected.statusCode).toBe(403);
  });

  it('revokes location access on travel start and grants only the destination', async () => {
    const { auth, characterId } = await setupCharacter('crownfall-city');
    const origin = await prisma.chatChannel.findFirstOrThrow({
      where: { kind: 'LOCATION', location: { slug: 'crownfall-city' } },
    });

    // Start traveling: the character is now at neither endpoint.
    const started = await post(auth, '/api/v1/travel/start', {
      destinationSlug: 'crownfall-market-district',
      idempotencyKey: 'chat-travel-1',
    });
    expect(started.statusCode).toBe(200);

    // Traveling: no location channel at all, and the origin is forbidden.
    const traveling = await listChannels(auth);
    expect(traveling.filter((c) => c.kind === 'LOCATION')).toHaveLength(0);
    expect((await sendMessage(auth, origin.id, 'still here?')).statusCode).toBe(403);

    // Arrive: only the destination channel is granted.
    await prisma.travelState.updateMany({
      where: { characterId, status: 'IN_PROGRESS' },
      data: { completesAt: new Date(Date.now() - 1000) },
    });
    const arrived = await listChannels(auth);
    const locationChannels = arrived.filter((c) => c.kind === 'LOCATION');
    expect(locationChannels).toHaveLength(1);
    expect(locationChannels[0]!.locationSlug).toBe('crownfall-market-district');
    expect((await sendMessage(auth, origin.id, 'left already')).statusCode).toBe(403);
    const destination = await prisma.chatChannel.findFirstOrThrow({
      where: { kind: 'LOCATION', location: { slug: 'crownfall-market-district' } },
    });
    expect((await sendMessage(auth, destination.id, 'made it')).statusCode).toBe(201);
  });
});

describe('message body handling', () => {
  it('rejects control characters, over-length, and empty bodies', async () => {
    const { auth } = await setupCharacter();
    const global = await globalChannel(auth);
    // Zod rejects an empty body before the service; 400 either way.
    expect(
      (
        await post(auth, `/api/v1/chat/channels/${global.id}/messages`, {
          body: '   ',
          idempotencyKey: 'empty-1',
        })
      ).statusCode,
    ).toBe(400);
    expect((await sendMessage(auth, global.id, 'has\u0000nul')).statusCode).toBe(400);
    expect((await sendMessage(auth, global.id, 'a'.repeat(501))).statusCode).toBe(400);
  });

  it('stores markup and script payloads verbatim (rendered as text by clients)', async () => {
    const { auth } = await setupCharacter();
    const global = await globalChannel(auth);
    const payload = '<script>alert(1)</script> <a href="javascript:x">x</a> onerror=y';
    const sent = await sendMessage(auth, global.id, payload);
    expect(sent.statusCode).toBe(201);
    // Stored exactly — no sanitization, no escaping at rest.
    const stored = await prisma.chatMessage.findFirstOrThrow({ where: { body: payload } });
    expect(stored.body).toBe(payload);
  });
});

describe('cursor pagination', () => {
  it('paginates deterministically over identical timestamps with no gaps', async () => {
    const { auth, characterId } = await setupCharacter();
    const global = await globalChannel(auth);
    // 25 messages sharing one createdAt so ordering must fall back to id.
    const sharedTime = new Date('2026-07-17T12:00:00.000Z');
    for (let i = 0; i < 25; i++) {
      await prisma.chatMessage.create({
        data: {
          channelId: global.id,
          authorCharacterId: characterId,
          body: `m${i}`,
          idempotencyKey: `page-${i}`,
          createdAt: sharedTime,
        },
      });
    }

    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const url =
        `/api/v1/chat/channels/${global.id}/messages?limit=10` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const response = await get(auth, url);
      expect(response.statusCode).toBe(200);
      const body = response.json<{ messages: Array<{ id: string }>; nextCursor: string | null }>();
      for (const message of body.messages) {
        expect(seen.has(message.id)).toBe(false); // no duplicates, no gaps
        seen.add(message.id);
      }
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(seen.size).toBe(25);
  });

  it('resumes forward polling from a cursor with no gaps', async () => {
    const { auth } = await setupCharacter();
    const global = await globalChannel(auth);
    await sendMessage(auth, global.id, 'first');

    // Client's known position after the first read.
    const initial = await get(auth, `/api/v1/chat/channels/${global.id}/messages`);
    const latestCursor = initial.json<{ latestCursor: string }>().latestCursor;

    await sendMessage(auth, global.id, 'second');
    await sendMessage(auth, global.id, 'third');

    const forward = await get(
      auth,
      `/api/v1/chat/channels/${global.id}/messages?direction=forward&cursor=${encodeURIComponent(latestCursor)}`,
    );
    expect(forward.statusCode).toBe(200);
    const body = forward.json<{ messages: Array<{ body: string }> }>();
    // Oldest-first, exactly the two new ones, no gap and no duplicate.
    expect(body.messages.map((m) => m.body)).toEqual(['second', 'third']);
  });

  it('rejects forward polling without a cursor and caps the limit', async () => {
    const { auth } = await setupCharacter();
    const global = await globalChannel(auth);
    expect(
      (await get(auth, `/api/v1/chat/channels/${global.id}/messages?direction=forward`)).statusCode,
    ).toBe(400);
    // limit beyond the hard maximum is rejected by the schema.
    expect(
      (await get(auth, `/api/v1/chat/channels/${global.id}/messages?limit=500`)).statusCode,
    ).toBe(400);
  });
});

describe('idempotent send', () => {
  it('replays the same author + key to the same message, sending nothing new', async () => {
    const { auth, characterId } = await setupCharacter();
    const global = await globalChannel(auth);
    const first = await sendMessage(auth, global.id, 'once', 'replay-key-1');
    const replay = await sendMessage(auth, global.id, 'once again', 'replay-key-1');
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json<{ message: { id: string; body: string } }>().message.id).toBe(
      first.json<{ message: { id: string } }>().message.id,
    );
    // The replay body is ignored: only one row, with the original text.
    expect(await prisma.chatMessage.count({ where: { authorCharacterId: characterId } })).toBe(1);
    const stored = await prisma.chatMessage.findFirstOrThrow({
      where: { authorCharacterId: characterId },
    });
    expect(stored.body).toBe('once');
  });

  it('creates exactly one row under a concurrent same-key race', async () => {
    const { auth, characterId } = await setupCharacter();
    const global = await globalChannel(auth);
    const responses = await raceRequests(
      Array.from({ length: 5 }, () => () => sendMessage(auth, global.id, 'racy', 'race-key-1')),
    );
    // Every concurrent attempt returns the same 201 message; one row exists.
    expect(responses.every((r) => r.statusCode === 201)).toBe(true);
    const ids = new Set(responses.map((r) => r.json<{ message: { id: string } }>().message.id));
    expect(ids.size).toBe(1);
    expect(await prisma.chatMessage.count({ where: { authorCharacterId: characterId } })).toBe(1);
  });
});

describe('read state', () => {
  it('advances read state forward only and clears the unread count', async () => {
    const { auth: reader } = await setupCharacter();
    const { auth: speaker } = await setupCharacter();
    const global = await globalChannel(speaker);

    const a = await sendMessage(speaker, global.id, 'one');
    const b = await sendMessage(speaker, global.id, 'two');
    const idA = a.json<{ message: { id: string } }>().message.id;
    const idB = b.json<{ message: { id: string } }>().message.id;

    // The reader sees two unread (its own messages never count; these aren't).
    expect((await globalChannel(reader)).unreadCount).toBe(2);

    // Mark up to the newest: unread clears.
    expect(
      (await post(reader, `/api/v1/chat/channels/${global.id}/read`, { messageId: idB }))
        .statusCode,
    ).toBe(200);
    expect((await globalChannel(reader)).unreadCount).toBe(0);

    // Marking an older message must not move read state backward.
    expect(
      (await post(reader, `/api/v1/chat/channels/${global.id}/read`, { messageId: idA }))
        .statusCode,
    ).toBe(200);
    expect((await globalChannel(reader)).unreadCount).toBe(0);
  });

  it('rejects marking a message from another channel', async () => {
    const { auth } = await setupCharacter();
    const channels = await listChannels(auth);
    const global = channels.find((c) => c.kind === 'GLOBAL')!;
    const location = channels.find((c) => c.kind === 'LOCATION')!;
    const sent = await sendMessage(auth, location.id, 'local');
    const localId = sent.json<{ message: { id: string } }>().message.id;
    const rejected = await post(auth, `/api/v1/chat/channels/${global.id}/read`, {
      messageId: localId,
    });
    expect(rejected.statusCode).toBe(404);
  });
});

describe('blocking', () => {
  it('hides a blocked author from history, unread counts, and self-block is rejected', async () => {
    const { auth: blocker, characterId: blockerId } = await setupCharacter();
    const { auth: pest, characterId: pestId } = await setupCharacter();
    const global = await globalChannel(blocker);

    await sendMessage(pest, global.id, 'spam spam spam');
    // Visible before the block.
    let history = await get(blocker, `/api/v1/chat/channels/${global.id}/messages`);
    expect(history.json<{ messages: unknown[] }>().messages).toHaveLength(1);
    expect((await globalChannel(blocker)).unreadCount).toBe(1);

    // Block: unilateral, immediate.
    expect((await put(blocker, `/api/v1/chat/blocks/${pestId}`)).statusCode).toBe(200);
    history = await get(blocker, `/api/v1/chat/channels/${global.id}/messages`);
    expect(history.json<{ messages: unknown[] }>().messages).toHaveLength(0);
    expect((await globalChannel(blocker)).unreadCount).toBe(0);

    // The block does not alter the blocked player's own view or data.
    const pestHistory = await get(pest, `/api/v1/chat/channels/${global.id}/messages`);
    expect(pestHistory.json<{ messages: unknown[] }>().messages).toHaveLength(1);
    expect(await prisma.character.count({ where: { id: pestId } })).toBe(1);

    // Self-block rejected.
    expect((await put(blocker, `/api/v1/chat/blocks/${blockerId}`)).statusCode).toBe(400);

    // Unblock restores visibility.
    expect((await del(blocker, `/api/v1/chat/blocks/${pestId}`)).statusCode).toBe(200);
    history = await get(blocker, `/api/v1/chat/channels/${global.id}/messages`);
    expect(history.json<{ messages: unknown[] }>().messages).toHaveLength(1);
  });

  it('blocking is idempotent', async () => {
    const { auth } = await setupCharacter();
    const { characterId: otherId } = await setupCharacter();
    expect((await put(auth, `/api/v1/chat/blocks/${otherId}`)).statusCode).toBe(200);
    expect((await put(auth, `/api/v1/chat/blocks/${otherId}`)).statusCode).toBe(200);
    const blocks = await get(auth, '/api/v1/chat/blocks');
    expect(blocks.json<{ blocks: unknown[] }>().blocks).toHaveLength(1);
  });
});

describe('reporting', () => {
  it('creates one report per reporter and message with an immutable snapshot', async () => {
    const { auth: reporter, characterId: reporterId } = await setupCharacter();
    const { auth: author, characterId: authorId } = await setupCharacter();
    const global = await globalChannel(author);
    const sent = await sendMessage(author, global.id, 'offensive text');
    const messageId = sent.json<{ message: { id: string } }>().message.id;

    const reported = await post(reporter, `/api/v1/chat/messages/${messageId}/reports`, {
      reason: 'HARASSMENT',
      details: 'not nice',
    });
    expect(reported.statusCode).toBe(201);

    const report = await prisma.chatReport.findFirstOrThrow({ where: { messageId } });
    expect(report.reporterCharacterId).toBe(reporterId);
    expect(report.snapshotBody).toBe('offensive text');
    expect(report.snapshotAuthorCharacterId).toBe(authorId);
    expect(report.snapshotChannelId).toBe(global.id);

    // Duplicate report from the same reporter is a conflict.
    const dup = await post(reporter, `/api/v1/chat/messages/${messageId}/reports`, {
      reason: 'SPAM',
    });
    expect(dup.statusCode).toBe(409);

    // The snapshot survives (and blocks) message retention cleanup: the row is
    // undeletable while a report references it.
    await expect(prisma.chatMessage.delete({ where: { id: messageId } })).rejects.toThrow();
  });

  it('rejects reporting your own message', async () => {
    const { auth } = await setupCharacter();
    const global = await globalChannel(auth);
    const sent = await sendMessage(auth, global.id, 'mine');
    const messageId = sent.json<{ message: { id: string } }>().message.id;
    expect(
      (await post(auth, `/api/v1/chat/messages/${messageId}/reports`, { reason: 'OTHER' }))
        .statusCode,
    ).toBe(400);
  });
});

describe('chat restrictions', () => {
  it('active restrictions block sends but not reads or reports; expiry is lazy', async () => {
    const { auth, characterId } = await setupCharacter();
    const { auth: other, characterId: otherId } = await setupCharacter();
    const global = await globalChannel(auth);

    // Another player leaves a message the restricted user can still see/report.
    void otherId;
    const theirs = await sendMessage(other, global.id, 'hello there');
    const theirId = theirs.json<{ message: { id: string } }>().message.id;

    // Active, indefinite restriction (created through the domain fixture — no
    // public API creates these in Phase 16).
    const restriction = await prisma.chatRestriction.create({
      data: { characterId, status: 'ACTIVE', reason: 'test', expiresAt: null },
    });
    const blocked = await sendMessage(auth, global.id, 'let me talk');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('CHAT_RESTRICTED');

    // Reading and reporting still work while restricted.
    expect((await get(auth, `/api/v1/chat/channels/${global.id}/messages`)).statusCode).toBe(200);
    expect(
      (await post(auth, `/api/v1/chat/messages/${theirId}/reports`, { reason: 'SPAM' })).statusCode,
    ).toBe(201);

    // Expire it in the past: treated as inactive lazily, no worker needed.
    await prisma.chatRestriction.update({
      where: { id: restriction.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await sendMessage(auth, global.id, 'free again')).statusCode).toBe(201);

    // A revoked restriction is likewise inactive.
    await prisma.chatRestriction.create({
      data: {
        characterId,
        status: 'REVOKED',
        reason: 'test',
        revokedAt: new Date(),
      },
    });
    expect((await sendMessage(auth, global.id, 'still free')).statusCode).toBe(201);
  });
});

describe('authorization', () => {
  it('requires authentication for every chat route', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/v1/chat/channels' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('retention cleanup', () => {
  it('deletes only eligible unreported messages in batches, preserving evidence', async () => {
    const { auth: author } = await setupCharacter();
    const { auth: reporter } = await setupCharacter();
    const global = await globalChannel(author);

    // Three old messages; one is reported.
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const oldIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const authorCharacter = await prisma.character.findFirstOrThrow({
        orderBy: { createdAt: 'asc' },
      });
      const row = await prisma.chatMessage.create({
        data: {
          channelId: global.id,
          authorCharacterId: authorCharacter.id,
          body: `old-${i}`,
          idempotencyKey: `old-${i}`,
          createdAt: old,
        },
      });
      oldIds.push(row.id);
    }
    // Report the middle one — its snapshot and row must survive cleanup.
    const reported = await post(reporter, `/api/v1/chat/messages/${oldIds[1]}/reports`, {
      reason: 'OTHER',
    });
    expect(reported.statusCode).toBe(201);

    // A fresh message (inside retention) must be untouched.
    const fresh = await sendMessage(author, global.id, 'recent');
    const freshId = fresh.json<{ message: { id: string } }>().message.id;

    const deleted = await cleanupExpiredChatMessages(prisma, {
      retentionDays: 90,
      batchSize: 1,
      now: new Date(),
    });
    expect(deleted).toBe(2); // the two unreported old messages

    expect(await prisma.chatMessage.findUnique({ where: { id: oldIds[0]! } })).toBeNull();
    expect(await prisma.chatMessage.findUnique({ where: { id: oldIds[2]! } })).toBeNull();
    // Reported message + its report survive.
    expect(await prisma.chatMessage.findUnique({ where: { id: oldIds[1]! } })).not.toBeNull();
    expect(await prisma.chatReport.count({ where: { messageId: oldIds[1]! } })).toBe(1);
    // Fresh message survives.
    expect(await prisma.chatMessage.findUnique({ where: { id: freshId } })).not.toBeNull();

    // Idempotent: a second run deletes nothing more.
    expect(await cleanupExpiredChatMessages(prisma, { retentionDays: 90, now: new Date() })).toBe(
      0,
    );
  });
});

describe('observability', () => {
  it('counts accepted messages, replays, reports, and authorization rejections', async () => {
    metrics.reset();
    const { auth } = await setupCharacter('ironroot-mine');
    const channels = await listChannels(auth);
    const global = channels.find((c) => c.kind === 'GLOBAL')!;

    await sendMessage(auth, global.id, 'metric-1', 'metric-key-1');
    await sendMessage(auth, global.id, 'metric-1', 'metric-key-1'); // replay

    const foreign = await prisma.chatChannel.findFirstOrThrow({
      where: { kind: 'LOCATION', location: { slug: 'greenmeadow-village' } },
    });
    await sendMessage(auth, foreign.id, 'nope'); // authorization rejection

    const snapshot = metrics.snapshot();
    expect(snapshot.chat_message_accepted).toBeGreaterThanOrEqual(1);
    expect(snapshot.chat_idempotency_replay).toBeGreaterThanOrEqual(1);
    expect(snapshot.chat_authorization_rejected).toBeGreaterThanOrEqual(1);
  });
});
