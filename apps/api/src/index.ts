/**
 * API process entrypoint (`npm run start:api`).
 * The worker process is separate (see worker.ts and ADR 0007).
 */
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { checkMigrationsApplied, createPrismaClient, pingDatabase } from './lib/prisma.js';

/** Grace period for draining in-flight requests before a forced exit. */
const SHUTDOWN_DEADLINE_MS = 15_000;

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = createPrismaClient(env);
  // Test harnesses (Playwright registers many accounts per run) may widen the
  // auth rate limit; production keeps the strict default.
  const authMaxOverride = Number(process.env['AUTH_RATE_LIMIT_MAX'] ?? '');
  const app = await buildApp({
    env,
    prisma,
    pingDatabase: () => pingDatabase(prisma),
    checkMigrations: () => checkMigrationsApplied(prisma),
    ...(Number.isInteger(authMaxOverride) && authMaxOverride > 0
      ? { authRateLimit: { max: authMaxOverride, timeWindowMs: 60_000 } }
      : {}),
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down API');
    // Force-exit if draining exceeds the deadline (a stuck request or socket
    // must not block the deploy indefinitely).
    const timer = setTimeout(() => {
      app.log.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    timer.unref();
    try {
      // Stops accepting new connections, closes idle sockets, and runs onClose
      // hooks (which stop the live-socket sweep and the chat pg listener).
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
