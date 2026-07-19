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

/**
 * Readiness migration check (Phase 18): "ok" when the `_prisma_migrations`
 * table exists and has no failed/rolled-back or unfinished migration, "pending"
 * when an unfinished one is present, "unknown" if the table is missing.
 */
export async function checkMigrationsApplied(
  prisma: PrismaClient,
): Promise<'ok' | 'pending' | 'unknown'> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ pending: bigint }>>(
      `SELECT COUNT(*)::bigint AS pending FROM "_prisma_migrations"
       WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL`,
    );
    const pending = rows[0]?.pending ?? 0n;
    return pending > 0n ? 'pending' : 'ok';
  } catch {
    return 'unknown';
  }
}
