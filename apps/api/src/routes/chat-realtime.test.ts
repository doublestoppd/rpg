import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import type { ChatMessageCreatedEvent } from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { SESSION_COOKIE } from '../plugins/auth-plugin.js';
import {
  buildTestApp,
  createTestPrisma,
  registerTestUser,
  TEST_ORIGIN,
  truncateAll,
} from '../test-helpers.js';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

type Auth = { cookie: string; csrf: string };

async function setupCharacter(app: FastifyInstance, locationSlug = 'crownfall-city') {
  const auth = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Herald ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'vanguard' },
  });
  expect(created.statusCode).toBe(201);
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  const location = await prisma.location.findUniqueOrThrow({ where: { slug: locationSlug } });
  await prisma.character.update({
    where: { id: character.id },
    data: { currentLocationId: location.id },
  });
  return { auth, characterId: character.id };
}

function send(app: FastifyInstance, auth: Auth, channelId: string, body: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/chat/channels/${channelId}/messages`,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { body, idempotencyKey: `rt-${randomUUID()}` },
  });
}

async function globalChannelId(app: FastifyInstance, auth: Auth): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/chat/channels',
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
  const channels = response.json<{ channels: Array<{ id: string; kind: string }> }>().channels;
  return channels.find((c) => c.kind === 'GLOBAL')!.id;
}

function openSocket(port: number, cookie: string): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/api/v1/notifications/ws`, {
    origin: TEST_ORIGIN,
    headers: { cookie: `${SESSION_COOKIE}=${cookie}` },
  });
}

function nextEvent(socket: WebSocket): Promise<ChatMessageCreatedEvent> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: Buffer) => {
      const parsed = JSON.parse(data.toString()) as { type: string };
      if (parsed.type === 'chat.message.created') {
        socket.off('message', onMessage);
        resolve(parsed as ChatMessageCreatedEvent);
      }
    };
    socket.on('message', onMessage);
    socket.on('error', reject);
  });
}

function awaitOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.on('open', () => resolve());
    socket.on('error', reject);
  });
}

describe('chat websocket authentication and origin', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    app = await buildTestApp(prisma);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    port = typeof address === 'object' && address ? address.port : 0;
  });
  afterAll(async () => {
    await app.close();
  });

  it('rejects an upgrade without a session', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/v1/notifications/ws`, {
      origin: TEST_ORIGIN,
    });
    await expect(awaitOpen(socket)).rejects.toBeTruthy();
    socket.terminate();
  });

  it('rejects an upgrade from a disallowed origin', async () => {
    const { auth } = await setupCharacter(app);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/v1/notifications/ws`, {
      origin: 'http://evil.example.com',
      headers: { cookie: `${SESSION_COOKIE}=${auth.cookie}` },
    });
    await expect(awaitOpen(socket)).rejects.toBeTruthy();
    socket.terminate();
  });

  it('delivers a committed message to an authorized socket, then polling still works', async () => {
    const { auth } = await setupCharacter(app);
    const channelId = await globalChannelId(app, auth);
    const socket = openSocket(port, auth.cookie);
    await awaitOpen(socket);

    const eventPromise = nextEvent(socket);
    // A second player sends; the first receives the invalidation.
    const { auth: speaker } = await setupCharacter(app);
    const sent = await send(app, speaker, channelId, 'live hello');
    expect(sent.statusCode).toBe(201);
    const event = await eventPromise;
    expect(event.channelId).toBe(channelId);
    expect(event.messageId).toBe(sent.json<{ message: { id: string } }>().message.id);
    // The event carries no message text.
    expect(JSON.stringify(event)).not.toContain('live hello');

    // Disconnect: REST history recovery still works.
    socket.close();
    await new Promise((resolve) => socket.once('close', resolve));
    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/chat/channels/${channelId}/messages`,
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(history.json<{ messages: unknown[] }>().messages).toHaveLength(1);
  });

  it('never delivers a blocked author’s message over the socket', async () => {
    const { auth: blocker } = await setupCharacter(app);
    const { auth: pest, characterId: pestId } = await setupCharacter(app);
    const channelId = await globalChannelId(app, blocker);

    // Block the pest.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/chat/blocks/${pestId}`,
      headers: { origin: TEST_ORIGIN, 'x-csrf-token': blocker.csrf },
      cookies: { [SESSION_COOKIE]: blocker.cookie },
    });

    const socket = openSocket(port, blocker.cookie);
    await awaitOpen(socket);
    let delivered = false;
    socket.on('message', (data: Buffer) => {
      const parsed = JSON.parse(data.toString()) as { type: string };
      if (parsed.type === 'chat.message.created') delivered = true;
    });

    await send(app, pest, channelId, 'blocked live');
    // Give the best-effort push a moment; it must never arrive.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(delivered).toBe(false);
    socket.close();
  });
});

describe('chat cross-instance fan-out', () => {
  let instanceA: FastifyInstance;
  let instanceB: FastifyInstance;
  let portB: number;

  beforeEach(async () => {
    // Two API instances against the same PostgreSQL database. Instance B
    // carries the live socket; instance A commits a message. LISTEN/NOTIFY
    // relays the invalidation from A to B.
    instanceA = await buildTestApp(prisma);
    instanceB = await buildTestApp(prisma);
    await instanceB.listen({ host: '127.0.0.1', port: 0 });
    const address = instanceB.server.address();
    portB = typeof address === 'object' && address ? address.port : 0;
    // Give both LISTEN connections a moment to establish.
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  afterEach(async () => {
    await instanceA.close();
    await instanceB.close();
  });

  it('a message committed on instance A invalidates a socket on instance B', async () => {
    const { auth: listener } = await setupCharacter(instanceB);
    const channelId = await globalChannelId(instanceB, listener);
    const socket = openSocket(portB, listener.cookie);
    await awaitOpen(socket);
    const eventPromise = nextEvent(socket);

    // Speaker commits on instance A.
    const { auth: speaker } = await setupCharacter(instanceA);
    const sent = await send(instanceA, speaker, channelId, 'cross-instance');
    expect(sent.statusCode).toBe(201);

    const event = await Promise.race([
      eventPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('no cross-instance event')), 5000),
      ),
    ]);
    expect(event.messageId).toBe(sent.json<{ message: { id: string } }>().message.id);
    socket.close();
  });

  it('with cross-instance NOTIFY unavailable, polling still recovers the message', async () => {
    // The message is committed and readable over REST regardless of any live
    // transport: the authoritative row is the source of truth.
    const { auth: reader } = await setupCharacter(instanceB);
    const channelId = await globalChannelId(instanceB, reader);
    const { auth: speaker } = await setupCharacter(instanceA);
    const sent = await send(instanceA, speaker, channelId, 'poll recovers');
    expect(sent.statusCode).toBe(201);

    // Instance B never saw a socket event in this scenario; a forward poll
    // from the reader's position recovers the message with no gap.
    const initial = await instanceB.inject({
      method: 'GET',
      url: `/api/v1/chat/channels/${channelId}/messages`,
      cookies: { [SESSION_COOKIE]: reader.cookie },
    });
    expect(initial.json<{ messages: Array<{ body: string }> }>().messages).toHaveLength(1);
  });
});
