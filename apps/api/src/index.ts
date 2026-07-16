/**
 * API process entrypoint (`npm run start:api`).
 * The worker process is separate (see worker.ts and ADR 0007).
 */
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPrismaClient, pingDatabase } from './lib/prisma.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = createPrismaClient(env);
  const app = await buildApp({ env, prisma, pingDatabase: () => pingDatabase(prisma) });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down API');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
