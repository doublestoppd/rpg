import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import { loadEnv, type Env } from './config/env.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://rpg:rpg@localhost:5432/rpg_test';

export const TEST_ORIGIN = 'http://localhost:5173';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    ...overrides,
  });
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
}

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  // Order matters only without CASCADE; TRUNCATE ... CASCADE handles FKs.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Session", "UserSettings", "User" RESTART IDENTITY CASCADE',
  );
}

export async function buildTestApp(
  prisma: PrismaClient,
  options: { authRateLimit?: { max: number; timeWindowMs: number } } = {},
): Promise<FastifyInstance> {
  return buildApp({
    env: testEnv(),
    prisma,
    pingDatabase: async () => {
      await prisma.$queryRawUnsafe('SELECT 1');
    },
    // High default so unrelated tests never trip the limiter; the dedicated
    // rate-limit test builds its own app with a small max.
    authRateLimit: options.authRateLimit ?? { max: 10_000, timeWindowMs: 60_000 },
  });
}

/** Extracts the value of a named cookie from an inject() response. */
export function cookieValue(
  response: { cookies: Array<{ name: string; value: string }> },
  name: string,
): string | undefined {
  return response.cookies.find((c) => c.name === name)?.value;
}
