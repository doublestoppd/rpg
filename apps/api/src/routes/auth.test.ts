import { createHash } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SESSION_COOKIE } from '../plugins/auth-plugin.js';
import {
  buildTestApp,
  cookieValue,
  createTestPrisma,
  TEST_ORIGIN,
  truncateAll,
} from '../test-helpers.js';

const REGISTER = {
  email: 'hero@example.com',
  password: 'correct horse battery',
  displayName: 'Heroine',
};

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

async function register(overrides: Partial<typeof REGISTER> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin: TEST_ORIGIN },
    payload: { ...REGISTER, ...overrides },
  });
}

async function login(payload: { email: string; password: string }) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: TEST_ORIGIN },
    payload,
  });
}

describe('registration and login', () => {
  it('registers, activates immediately, and sets a session cookie', async () => {
    const response = await register();
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.user.email).toBe(REGISTER.email);
    expect(body.user.displayName).toBe(REGISTER.displayName);
    expect(body.user.role).toBe('USER');
    expect(body.csrfToken).toBeTruthy();
    expect(cookieValue(response, SESSION_COOKIE)).toBeTruthy();
  });

  it('normalizes email and enforces uniqueness', async () => {
    await register();
    const duplicate = await register({ email: '  HERO@Example.COM ', displayName: 'Other' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('EMAIL_TAKEN');
  });

  it('logs in with normalized email and rejects bad credentials generically', async () => {
    await register();
    const ok = await login({ email: 'HERO@example.com', password: REGISTER.password });
    expect(ok.statusCode).toBe(200);

    const badPassword = await login({ email: REGISTER.email, password: 'wrong password' });
    const badEmail = await login({ email: 'nobody@example.com', password: REGISTER.password });
    expect(badPassword.statusCode).toBe(401);
    expect(badEmail.statusCode).toBe(401);
    // Identical generic body for unknown email and wrong password.
    expect(badPassword.json().error.message).toBe(badEmail.json().error.message);
  });

  it('never stores the raw session token in the database', async () => {
    const response = await register();
    const raw = cookieValue(response, SESSION_COOKIE)!;
    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toBe(createHash('sha256').update(raw).digest('hex'));
    for (const value of Object.values(sessions[0]!)) {
      expect(value).not.toBe(raw);
    }
  });
});

describe('session persistence and inspection', () => {
  it('keeps the session valid across repeated requests (refresh survival)', async () => {
    const response = await register();
    const raw = cookieValue(response, SESSION_COOKIE)!;
    for (let i = 0; i < 2; i++) {
      const session = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        cookies: { [SESSION_COOKIE]: raw },
      });
      expect(session.statusCode).toBe(200);
      expect(session.json().user.email).toBe(REGISTER.email);
    }
  });

  it('rejects unauthenticated session inspection', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
    expect(response.statusCode).toBe(401);
  });
});

describe('logout and revocation', () => {
  it('logout invalidates the session', async () => {
    const registered = await register();
    const raw = cookieValue(registered, SESSION_COOKIE)!;
    const csrf = registered.json().csrfToken as string;

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin: TEST_ORIGIN, 'x-csrf-token': csrf },
      cookies: { [SESSION_COOKIE]: raw },
    });
    expect(logout.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      cookies: { [SESSION_COOKIE]: raw },
    });
    expect(after.statusCode).toBe(401);
  });

  it('revoke-other-sessions invalidates every other session', async () => {
    const first = await register();
    const firstRaw = cookieValue(first, SESSION_COOKIE)!;
    const second = await login({ email: REGISTER.email, password: REGISTER.password });
    const secondRaw = cookieValue(second, SESSION_COOKIE)!;
    const secondCsrf = second.json().csrfToken as string;

    const revoke = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/revoke-other-sessions',
      headers: { origin: TEST_ORIGIN, 'x-csrf-token': secondCsrf },
      cookies: { [SESSION_COOKIE]: secondRaw },
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().revokedCount).toBe(1);

    const revoked = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      cookies: { [SESSION_COOKIE]: firstRaw },
    });
    expect(revoked.statusCode).toBe(401);

    const still = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      cookies: { [SESSION_COOKIE]: secondRaw },
    });
    expect(still.statusCode).toBe(200);
  });
});

describe('password change', () => {
  it('rotates the session token and accepts only the new password', async () => {
    const registered = await register();
    const oldRaw = cookieValue(registered, SESSION_COOKIE)!;
    const csrf = registered.json().csrfToken as string;

    const change = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { origin: TEST_ORIGIN, 'x-csrf-token': csrf },
      cookies: { [SESSION_COOKIE]: oldRaw },
      payload: { currentPassword: REGISTER.password, newPassword: 'a brand new passphrase' },
    });
    expect(change.statusCode).toBe(200);
    const newRaw = cookieValue(change, SESSION_COOKIE)!;
    expect(newRaw).not.toBe(oldRaw);

    // Old token is revoked; the new one works.
    const oldSession = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      cookies: { [SESSION_COOKIE]: oldRaw },
    });
    expect(oldSession.statusCode).toBe(401);
    const newSession = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      cookies: { [SESSION_COOKIE]: newRaw },
    });
    expect(newSession.statusCode).toBe(200);

    const oldLogin = await login({ email: REGISTER.email, password: REGISTER.password });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await login({
      email: REGISTER.email,
      password: 'a brand new passphrase',
    });
    expect(newLogin.statusCode).toBe(200);
  });
});

describe('CSRF and Origin protection', () => {
  it('rejects state-changing requests with a missing or unlisted Origin', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: REGISTER,
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error.code).toBe('ORIGIN_FORBIDDEN');

    const evil = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'https://evil.example.com' },
      payload: REGISTER,
    });
    expect(evil.statusCode).toBe(403);
  });

  it('rejects authenticated state-changing requests without a valid CSRF token', async () => {
    const registered = await register();
    const raw = cookieValue(registered, SESSION_COOKIE)!;

    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/revoke-other-sessions',
      headers: { origin: TEST_ORIGIN },
      cookies: { [SESSION_COOKIE]: raw },
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error.code).toBe('CSRF_FORBIDDEN');

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/revoke-other-sessions',
      headers: { origin: TEST_ORIGIN, 'x-csrf-token': 'forged-token' },
      cookies: { [SESSION_COOKIE]: raw },
    });
    expect(wrong.statusCode).toBe(403);
  });
});

describe('rate limiting', () => {
  it('rate-limits login attempts', async () => {
    const limitedApp = await buildTestApp(prisma, {
      authRateLimit: { max: 3, timeWindowMs: 60_000 },
    });
    try {
      const attempt = () =>
        limitedApp.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { origin: TEST_ORIGIN },
          payload: { email: 'nobody@example.com', password: 'nope nope nope' },
        });
      for (let i = 0; i < 3; i++) {
        expect((await attempt()).statusCode).toBe(401);
      }
      expect((await attempt()).statusCode).toBe(429);
    } finally {
      await limitedApp.close();
    }
  });
});

describe('account settings', () => {
  it('reads defaults and applies partial updates', async () => {
    const registered = await register();
    const raw = cookieValue(registered, SESSION_COOKIE)!;
    const csrf = registered.json().csrfToken as string;

    const initial = await app.inject({
      method: 'GET',
      url: '/api/v1/account/settings',
      cookies: { [SESSION_COOKIE]: raw },
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({ theme: 'SYSTEM' });

    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/v1/account/settings',
      headers: { origin: TEST_ORIGIN, 'x-csrf-token': csrf },
      cookies: { [SESSION_COOKIE]: raw },
      payload: { theme: 'DARK' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ theme: 'DARK' });
  });
});
