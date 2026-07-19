import type { PrismaClient } from '@prisma/client';

/**
 * Bounded, batched, idempotent retention cleanup for visible chat messages.
 * Best-effort worker acceleration only — chat correctness never depends on
 * it. Reported messages are excluded here AND undeletable at the database
 * level (the ChatReport→ChatMessage relation is RESTRICT), so report
 * evidence, restrictions, read-state correctness, and every other audit
 * domain survive cleanup by construction.
 */
export async function cleanupExpiredChatMessages(
  prisma: PrismaClient,
  options: { retentionDays: number; batchSize?: number; now?: Date },
): Promise<number> {
  const batchSize = options.batchSize ?? 500;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.retentionDays * 24 * 60 * 60 * 1000);
  let total = 0;
  for (;;) {
    const batch = await prisma.chatMessage.findMany({
      where: { createdAt: { lt: cutoff }, reports: { none: {} } },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    });
    if (batch.length === 0) return total;
    // The unreported filter is re-applied inside the delete so a report
    // created between the two statements can never be orphaned of its row.
    const deleted = await prisma.chatMessage.deleteMany({
      where: { id: { in: batch.map((row) => row.id) }, reports: { none: {} } },
    });
    total += deleted.count;
    if (batch.length < batchSize || deleted.count === 0) return total;
  }
}
