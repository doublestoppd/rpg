/**
 * Job worker process entrypoint (`npm run start:worker`).
 *
 * Runs pg-boss job consumers. In production this is always a separate process
 * from the API; the API may enqueue jobs but never consumes them (ADR 0007).
 * pg-boss is never the sole authority for timed-state completion (ADR 0004).
 *
 * No job types exist yet — gameplay phases register their own consumers here.
 */
import { PgBoss } from 'pg-boss';

import { loadEnv } from './config/env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const boss = new PgBoss({ connectionString: env.DATABASE_URL });

  boss.on('error', (error: unknown) => {
    console.error(JSON.stringify({ level: 'error', msg: 'pg-boss error', err: String(error) }));
  });

  await boss.start();
  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'worker started; no job types registered yet (Phase 1)',
      timestamp: new Date().toISOString(),
    }),
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(JSON.stringify({ level: 'info', msg: 'worker shutting down', signal }));
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
