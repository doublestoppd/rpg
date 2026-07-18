/**
 * Administrator promotion CLI (`npm run admin:promote -- <email-or-name>`).
 *
 * Deliberately explicit and out-of-band: there is no default administrator and
 * no startup-created credential. Promotes an existing account to ADMIN, revokes
 * its sessions, and writes a SYSTEM bootstrap audit row. In production it
 * requires ADMIN_BOOTSTRAP_ENABLED=true. The account email/name is not a secret
 * and may be passed on the command line; no password is read here.
 */
import { loadEnv } from './config/env.js';
import { BootstrapError, promoteToAdmin } from './domain/admin/admin-bootstrap.js';
import { createPrismaClient } from './lib/prisma.js';

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', msg, ...extra }));
}

async function main(): Promise<void> {
  const identifier = process.argv[2];
  if (!identifier) {
    console.error('usage: npm run admin:promote -- <account-email-or-display-name>');
    process.exit(2);
  }
  const env = loadEnv();
  const prisma = createPrismaClient(env);
  try {
    const result = await promoteToAdmin(prisma, {
      identifier,
      nodeEnv: env.NODE_ENV,
      bootstrapEnabled: env.ADMIN_BOOTSTRAP_ENABLED,
    });
    if (result.changed) {
      log('account promoted to ADMIN', {
        userId: result.userId,
        displayName: result.displayName,
        revokedSessions: result.revokedSessions,
      });
    } else {
      log('account is already an administrator; no change', { userId: result.userId });
    }
  } catch (error) {
    if (error instanceof BootstrapError) {
      console.error(JSON.stringify({ level: 'error', code: error.code, msg: error.message }));
      process.exit(1);
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
