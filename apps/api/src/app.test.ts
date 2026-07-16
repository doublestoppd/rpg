import { describe, expect, it } from 'vitest';

import { healthResponseSchema } from '@rpg/shared';

import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const testEnvSource = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
};

describe('GET /api/v1/health', () => {
  it('returns 200 with database ok when the database responds', async () => {
    const app = await buildApp({
      env: loadEnv(testEnvSource),
      pingDatabase: async () => undefined,
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    const body = healthResponseSchema.parse(response.json());
    expect(body.status).toBe('ok');
    expect(body.api).toBe('ok');
    expect(body.database).toBe('ok');
    await app.close();
  });

  it('returns 503 degraded when the database is unreachable', async () => {
    const app = await buildApp({
      env: loadEnv(testEnvSource),
      pingDatabase: async () => {
        throw new Error('connection refused');
      },
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(503);
    const body = healthResponseSchema.parse(response.json());
    expect(body.status).toBe('degraded');
    expect(body.database).toBe('unreachable');
    await app.close();
  });

  it('serves OpenAPI documentation generated from route schemas', async () => {
    const app = await buildApp({
      env: loadEnv(testEnvSource),
      pingDatabase: async () => undefined,
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/docs/json' });

    expect(response.statusCode).toBe(200);
    const spec = response.json() as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).toContain('/api/v1/health');
    await app.close();
  });

  it('returns the generic error envelope for unknown routes', async () => {
    const app = await buildApp({
      env: loadEnv(testEnvSource),
      pingDatabase: async () => undefined,
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    await app.close();
  });
});
