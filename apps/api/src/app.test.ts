import { PrismaClient } from '@prisma/client';
import { healthResponseSchema } from '@rpg/shared';
import { describe, expect, it } from 'vitest';

import { type AppDependencies, buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const testEnvSource = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
};

// Health tests never issue queries (no session cookie is sent), so a lazily
// connecting client with an unreachable URL is fine.
const idlePrisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://test:test@localhost:5999/unused' } },
});

function deps(
  pingDatabase: AppDependencies['pingDatabase'],
  overrides: Record<string, string> = {},
): AppDependencies {
  return {
    env: loadEnv({ ...testEnvSource, ...overrides }),
    prisma: idlePrisma,
    pingDatabase,
    checkMigrations: async () => 'ok',
  };
}

describe('GET /api/v1/health', () => {
  it('returns 200 with database ok when the database responds', async () => {
    const app = await buildApp(deps(async () => undefined));
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    const body = healthResponseSchema.parse(response.json());
    expect(body.status).toBe('ok');
    expect(body.api).toBe('ok');
    expect(body.database).toBe('ok');
    await app.close();
  });

  it('returns 503 degraded when the database is unreachable', async () => {
    const app = await buildApp(
      deps(async () => {
        throw new Error('connection refused');
      }),
    );
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(503);
    const body = healthResponseSchema.parse(response.json());
    expect(body.status).toBe('degraded');
    expect(body.database).toBe('unreachable');
    await app.close();
  });

  it('serves OpenAPI documentation generated from route schemas', async () => {
    const app = await buildApp(deps(async () => undefined));
    const response = await app.inject({ method: 'GET', url: '/api/v1/docs/json' });

    expect(response.statusCode).toBe(200);
    const spec = response.json();
    expect(Object.keys(spec.paths)).toContain('/api/v1/health');
    await app.close();
  });

  it('returns the generic error envelope for unknown routes', async () => {
    const app = await buildApp(deps(async () => undefined));
    const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    await app.close();
  });
});

describe('security headers (Phase 18)', () => {
  it('sets conservative security headers on every response', async () => {
    const app = await buildApp(deps(async () => undefined));
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(String(response.headers['content-security-policy'])).toContain("default-src 'none'");
    // HSTS is absent unless explicitly enabled (no TLS assumption).
    expect(response.headers['strict-transport-security']).toBeUndefined();
    await app.close();
  });

  it('sends HSTS only when ENABLE_HSTS=true', async () => {
    const app = await buildApp(deps(async () => undefined, { ENABLE_HSTS: 'true' }));
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(String(response.headers['strict-transport-security'])).toContain('max-age=');
    await app.close();
  });
});

describe('liveness and readiness (Phase 18)', () => {
  it('liveness is 200 without touching the database', async () => {
    const app = await buildApp(
      deps(async () => {
        throw new Error('db down');
      }),
    );
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    // Liveness ignores the database entirely.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'alive' });
    await app.close();
  });

  it('readiness is 200 when database and migrations are ok', async () => {
    const app = await buildApp(deps(async () => undefined));
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ready', database: 'ok', migrations: 'ok' });
    await app.close();
  });

  it('readiness is 503 when the database is unreachable', async () => {
    const app = await buildApp(
      deps(async () => {
        throw new Error('db down');
      }),
    );
    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'not_ready', database: 'unreachable' });
    await app.close();
  });
});

describe('body limit (Phase 18)', () => {
  it('rejects an oversized request body', async () => {
    const app = await buildApp(deps(async () => undefined));
    const huge = 'x'.repeat(300 * 1024);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'a@b.c', password: huge }),
    });
    expect(response.statusCode).toBe(413);
    await app.close();
  });
});

describe('metrics endpoint (Phase 18)', () => {
  it('is disabled (404) when no token is configured', async () => {
    const app = await buildApp(deps(async () => undefined));
    const response = await app.inject({ method: 'GET', url: '/api/v1/metrics' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('requires the bearer token and emits OpenMetrics text with no user labels', async () => {
    const app = await buildApp(deps(async () => undefined, { METRICS_TOKEN: 'scrape-secret' }));
    expect((await app.inject({ method: 'GET', url: '/api/v1/metrics' })).statusCode).toBe(401);
    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics',
      headers: { authorization: 'Bearer scrape-secret' },
    });
    expect(ok.statusCode).toBe(200);
    expect(String(ok.headers['content-type'])).toContain('text/plain');
    expect(ok.body).toContain('rpg_idempotency_replay_total');
    expect(ok.body).toContain('# TYPE');
    await app.close();
  });
});
