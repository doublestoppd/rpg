/**
 * Job worker process entrypoint (`npm run start:worker`).
 *
 * Runs pg-boss job consumers. In production this is always a separate process
 * from the API; the API may enqueue jobs but never consumes them (ADR 0007).
 * pg-boss is never the sole authority for timed-state completion (ADR 0004):
 * every job here is a cleanup accelerator for state the lazy request paths
 * already finalize correctly.
 */
import { PgBoss } from 'pg-boss';

import { loadEnv } from './config/env.js';
import { createInventoryService } from './domain/inventory/inventory-service.js';
import { sweepExpiredListings } from './domain/marketplace/marketplace-service.js';
import { metrics } from './lib/metrics.js';
import { createPrismaClient } from './lib/prisma.js';

const CLEANUP_QUEUE = 'marketplace-expired-listing-cleanup';

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

  // Periodic expired-listing cleanup (returns held assets to sellers). The
  // lazy finalizers on marketplace/inventory views remain the authority.
  await boss.createQueue(CLEANUP_QUEUE);
  await boss.schedule(CLEANUP_QUEUE, '*/5 * * * *');
  await boss.work(CLEANUP_QUEUE, async () => {
    const finalized = await sweepExpiredListings(prisma, inventoryService, 100);
    if (finalized > 0) log('info', 'expired listings finalized', { finalized });
  });

  log('info', 'worker started', { queues: [CLEANUP_QUEUE] });

  const shutdown = async (signal: string): Promise<void> => {
    log('info', 'worker shutting down', { signal });
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
