import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
  // Tiny buckets: burst 2 per account and per IP, slow refill so the window
  // stays closed for the duration of the test.
  app = await buildTestApp(prisma, {
    envOverrides: {
      CHAT_RATE_LIMIT_BURST: '2',
      CHAT_RATE_LIMIT_PER_MINUTE: '1',
      CHAT_RATE_LIMIT_IP_BURST: '100',
      CHAT_RATE_LIMIT_IP_PER_MINUTE: '600',
    },
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

type Auth = { cookie: string; csrf: string };

async function setupCharacter() {
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
  const location = await prisma.location.findUniqueOrThrow({ where: { slug: 'crownfall-city' } });
  await prisma.character.update({
    where: { id: character.id },
    data: { currentLocationId: location.id },
  });
  return auth;
}

let counter = 0;
function send(auth: Auth, channelId: string) {
  counter += 1;
  return app.inject({
    method: 'POST',
    url: `/api/v1/chat/channels/${channelId}/messages`,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: {
      body: `m${counter}`,
      idempotencyKey: `rl-${counter}-${Math.random().toString(36).slice(2)}`,
    },
  });
}

async function globalChannelId(auth: Auth): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/chat/channels',
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
  return response
    .json<{ channels: Array<{ id: string; kind: string }> }>()
    .channels.find((c) => c.kind === 'GLOBAL')!.id;
}

describe('chat send rate limiting', () => {
  it('allows the burst then returns 429 with a bounded retry-after', async () => {
    const auth = await setupCharacter();
    const channelId = await globalChannelId(auth);
    expect((await send(auth, channelId)).statusCode).toBe(201);
    expect((await send(auth, channelId)).statusCode).toBe(201);
    const limited = await send(auth, channelId);
    expect(limited.statusCode).toBe(429);
    const body = limited.json<{ error: { code: string; retryAfterSeconds: number } }>();
    expect(body.error.code).toBe('CHAT_RATE_LIMITED');
    expect(body.error.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.error.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('cannot be bypassed by switching channels', async () => {
    const auth = await setupCharacter();
    const channels = await app.inject({
      method: 'GET',
      url: '/api/v1/chat/channels',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    const list = channels.json<{ channels: Array<{ id: string; kind: string }> }>().channels;
    const global = list.find((c) => c.kind === 'GLOBAL')!.id;
    const location = list.find((c) => c.kind === 'LOCATION')!.id;
    // The account bucket is shared across channels: 2 sends total, then 429.
    expect((await send(auth, global)).statusCode).toBe(201);
    expect((await send(auth, location)).statusCode).toBe(201);
    expect((await send(auth, global)).statusCode).toBe(429);
  });

  it('a rejected send never creates a message row', async () => {
    const auth = await setupCharacter();
    const channelId = await globalChannelId(auth);
    await send(auth, channelId);
    await send(auth, channelId);
    const before = await prisma.chatMessage.count();
    expect((await send(auth, channelId)).statusCode).toBe(429);
    expect(await prisma.chatMessage.count()).toBe(before);
  });
});
