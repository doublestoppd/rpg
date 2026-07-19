import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { promoteToAdmin } from '../domain/admin/admin-bootstrap.js';
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
  // A tiny reauth budget so the limiter trips deterministically.
  app = await buildTestApp(prisma, { envOverrides: { ADMIN_REAUTH_RATE_LIMIT_MAX: '3' } });
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await truncateAll(prisma);
});

describe('admin reauth rate limiting', () => {
  it('returns 429 after the configured number of attempts', async () => {
    const unique = Math.random().toString(36).slice(2, 10);
    const email = `rl-${unique}@example.com`;
    await registerTestUser(app, { email, displayName: `Rl${unique}` });
    await promoteToAdmin(prisma, {
      identifier: email,
      nodeEnv: 'test',
      bootstrapEnabled: undefined,
    });
    const loginResp = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: TEST_ORIGIN },
      payload: { email, password: 'a test passphrase' },
    });
    const cookie = loginResp.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    const csrf = loginResp.json<{ csrfToken: string }>().csrfToken;

    const attempt = (password: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/admin/reauth',
        headers: { origin: TEST_ORIGIN, 'x-csrf-token': csrf },
        cookies: { [SESSION_COOKIE]: cookie },
        payload: { password },
      });

    // Three attempts within budget (wrong password → 401), then the fourth is
    // rate-limited (429) regardless of correctness.
    expect((await attempt('wrong-1')).statusCode).toBe(401);
    expect((await attempt('wrong-2')).statusCode).toBe(401);
    expect((await attempt('wrong-3')).statusCode).toBe(401);
    expect((await attempt('a test passphrase')).statusCode).toBe(429);
  });
});
