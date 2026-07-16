import { PrismaClient } from '@prisma/client';

import type { Env } from '../config/env.js';

export function createPrismaClient(env: Env): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
  });
}

/** Cheap connectivity probe used by the health endpoint. Rejects when the database is unreachable. */
export async function pingDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRawUnsafe('SELECT 1');
}
