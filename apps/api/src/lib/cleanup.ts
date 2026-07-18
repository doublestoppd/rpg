import type { PrismaClient } from '@prisma/client';

/**
 * Data-lifecycle cleanup (Phase 18). Batched, idempotent removal of support
 * records that are safe to drop after a retention window. This is best-effort
 * worker acceleration; correctness never depends on it.
 *
 * The ALLOWLIST is the single source of truth for what cleanup may ever touch.
 * Audit and economic evidence — CurrencyTransaction, ItemTransfer,
 * ItemDestruction, MarketplaceSale, collection donations, AdminAuditLog,
 * ChatModerationAction, ChatReport — are deliberately absent and are retained
 * per the long-term/indefinite audit policy.
 */
export const CLEANUP_DELETABLE_TABLES = ['Session', 'Notification'] as const;
export type CleanupTable = (typeof CLEANUP_DELETABLE_TABLES)[number];

/** Compile-time guard: every table cleanup deletes from must be allowlisted. */
function assertDeletable(table: CleanupTable): void {
  if (!CLEANUP_DELETABLE_TABLES.includes(table)) {
    throw new Error(`cleanup: ${table} is not in the deletable allowlist`);
  }
}

export interface CleanupOptions {
  sessionRetentionDays: number;
  notificationRetentionDays: number;
  batchSize?: number;
  now?: Date;
}

export interface CleanupResult {
  sessionsDeleted: number;
  notificationsDeleted: number;
}

async function deleteInBatches(
  count: () => Promise<Array<{ id: string }>>,
  remove: (ids: string[]) => Promise<number>,
  batchSize: number,
): Promise<number> {
  let total = 0;
  for (;;) {
    const batch = await count();
    if (batch.length === 0) return total;
    const deleted = await remove(batch.map((row) => row.id));
    total += deleted;
    if (batch.length < batchSize || deleted === 0) return total;
  }
}

export async function runCleanup(
  prisma: PrismaClient,
  options: CleanupOptions,
): Promise<CleanupResult> {
  const batchSize = options.batchSize ?? 1000;
  const now = options.now ?? new Date();

  assertDeletable('Session');
  const sessionCutoff = new Date(now.getTime() - options.sessionRetentionDays * 86_400_000);
  // Expired or revoked sessions past the retention window carry no value; the
  // raw token never existed in the row, so this is not security-sensitive.
  const sessionsDeleted = await deleteInBatches(
    () =>
      prisma.session.findMany({
        where: {
          OR: [{ expiresAt: { lt: sessionCutoff } }, { revokedAt: { lt: sessionCutoff } }],
        },
        select: { id: true },
        take: batchSize,
      }),
    (ids) => prisma.session.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
    batchSize,
  );

  assertDeletable('Notification');
  const notificationCutoff = new Date(
    now.getTime() - options.notificationRetentionDays * 86_400_000,
  );
  // Only READ notifications older than the window are removed; unread ones are
  // kept regardless of age so a player never loses a pending signal.
  const notificationsDeleted = await deleteInBatches(
    () =>
      prisma.notification.findMany({
        where: { readAt: { not: null, lt: notificationCutoff } },
        select: { id: true },
        take: batchSize,
      }),
    (ids) => prisma.notification.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
    batchSize,
  );

  return { sessionsDeleted, notificationsDeleted };
}
