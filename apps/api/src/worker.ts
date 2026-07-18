/**
 * Job worker process entrypoint (`npm run start:worker`).
 *
 * Runs pg-boss job consumers. In production this is always a separate process
 * from the API; the API may enqueue jobs but never consumes them (ADR 0007).
 * pg-boss is never the sole authority for timed-state completion (ADR 0004):
 * every job here is a cleanup accelerator for state the lazy request paths
 * already finalize correctly.
 */
import { createServer } from 'node:http';

import { PgBoss } from 'pg-boss';

import { loadEnv } from './config/env.js';
import { cleanupExpiredChatMessages } from './domain/chat/chat-cleanup.js';
import { createInventoryService } from './domain/inventory/inventory-service.js';
import { sweepExpiredListings } from './domain/marketplace/marketplace-service.js';
import { runCleanup } from './lib/cleanup.js';
import { metrics } from './lib/metrics.js';
import { createPrismaClient } from './lib/prisma.js';

const CLEANUP_QUEUE = 'marketplace-expired-listing-cleanup';
const CHAT_CLEANUP_QUEUE = 'chat-retention-cleanup';
const DATA_CLEANUP_QUEUE = 'data-lifecycle-cleanup';

/** Worker is unhealthy if it has not polled successfully within this window. */
const HEALTH_STALE_MS = 5 * 60 * 1000;

function log(level: string, msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, msg, timestamp: new Date().toISOString(), ...extra }));
}

async function main(): Promise<void> {
  const env = loadEnv();
  const boss = new PgBoss({ connectionString: env.DATABASE_URL });
  const prisma = createPrismaClient(env);
  const inventoryService = createInventoryService(prisma);

  boss.on('error', (error: unknown) => {
    metrics.increment('worker_failure');
    console.error(JSON.stringify({ level: 'error', msg: 'pg-boss error', err: String(error) }));
  });

  await boss.start();

  // Recent-poll marker for the health probe (updated whenever a job runs).
  let lastPollAt = Date.now();
  const markPoll = () => {
    lastPollAt = Date.now();
  };

  // Periodic expired-listing cleanup (returns held assets to sellers). The
  // lazy finalizers on marketplace/inventory views remain the authority.
  await boss.createQueue(CLEANUP_QUEUE);
  await boss.schedule(CLEANUP_QUEUE, '*/5 * * * *');
  await boss.work(CLEANUP_QUEUE, async () => {
    markPoll();
    const finalized = await sweepExpiredListings(prisma, inventoryService, 100);
    if (finalized > 0) log('info', 'expired listings finalized', { finalized });
  });

  // Daily chat retention cleanup (batched, idempotent, best-effort). Chat
  // correctness never depends on it; reported messages are undeletable.
  await boss.createQueue(CHAT_CLEANUP_QUEUE);
  await boss.schedule(CHAT_CLEANUP_QUEUE, '30 4 * * *');
  await boss.work(CHAT_CLEANUP_QUEUE, async () => {
    markPoll();
    const deleted = await cleanupExpiredChatMessages(prisma, {
      retentionDays: env.CHAT_RETENTION_DAYS,
    });
    if (deleted > 0) log('info', 'expired chat messages cleaned up', { deleted });
  });

  // Data-lifecycle cleanup: expired sessions + old read notifications (batched,
  // idempotent, allowlisted — audit/economic records are never touched).
  await boss.createQueue(DATA_CLEANUP_QUEUE);
  await boss.schedule(DATA_CLEANUP_QUEUE, '0 3 * * *');
  await boss.work(DATA_CLEANUP_QUEUE, async () => {
    markPoll();
    const result = await runCleanup(prisma, {
      sessionRetentionDays: env.SESSION_RETENTION_DAYS,
      notificationRetentionDays: env.NOTIFICATION_RETENTION_DAYS,
    });
    if (result.sessionsDeleted > 0 || result.notificationsDeleted > 0) {
      log('info', 'data lifecycle cleanup', { ...result });
    }
  });

  // Non-public worker health probe: liveness + recent successful poll. Worker
  // health is deliberately NOT part of gameplay correctness (ADR 0004).
  let healthServer: ReturnType<typeof createServer> | null = null;
  if (env.WORKER_HEALTH_PORT > 0) {
    healthServer = createServer((req, res) => {
      const stale = Date.now() - lastPollAt > HEALTH_STALE_MS;
      // Alive as long as the process responds; readiness also requires a recent
      // poll. Right after startup lastPollAt is "now", so it starts ready.
      const ready = !stale;
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: ready ? 'ok' : 'stale', lastPollAt, path: req.url }));
    });
    healthServer.listen(env.WORKER_HEALTH_PORT, () =>
      log('info', 'worker health probe listening', { port: env.WORKER_HEALTH_PORT }),
    );
  }

  log('info', 'worker started', {
    queues: [CLEANUP_QUEUE, CHAT_CLEANUP_QUEUE, DATA_CLEANUP_QUEUE],
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'worker shutting down', { signal });
    const timer = setTimeout(() => {
      log('error', 'worker shutdown timed out; forcing exit');
      process.exit(1);
    }, 15_000);
    timer.unref();
    // Graceful: finish or safely abandon leased jobs, then close resources.
    if (healthServer) healthServer.close();
    await boss.stop({ graceful: true });
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
