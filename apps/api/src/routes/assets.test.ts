import { ASSET_ROLES, assetsResponseSchema } from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, createTestPrisma } from '../test-helpers.js';

let app: FastifyInstance;
const prisma = createTestPrisma();

beforeAll(async () => {
  app = await buildTestApp(prisma);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('GET /assets', () => {
  it('serves the asset manifest publicly (no auth) with a cache header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/assets' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age');
    const manifest = assetsResponseSchema.parse(res.json());
    for (const role of ASSET_ROLES) {
      expect(manifest.roleDefaults[role], `default for ${role}`).toBeTruthy();
    }
  });
});
