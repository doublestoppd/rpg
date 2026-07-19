import type { PrismaClient } from '@prisma/client';

/**
 * Explicit administrator promotion (Phase 17). There is NO default admin
 * account, no startup-seeded credential, and no password in source or images:
 * an operator deliberately runs this against an existing account. The command
 * is idempotent, refuses ambiguous targets, revokes the promoted user's
 * sessions (forcing a fresh login), and writes a SYSTEM bootstrap audit row in
 * the same transaction. In production it requires an explicit allow flag.
 */

export class BootstrapError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BootstrapError';
  }
}

export interface PromoteOptions {
  /** Exact email or display name of the account to elevate. */
  identifier: string;
  /** process.env.NODE_ENV at call time. */
  nodeEnv: string;
  /** Value of ADMIN_BOOTSTRAP_ENABLED; must be "true" to run in production. */
  bootstrapEnabled: string | undefined;
}

export interface PromoteResult {
  userId: string;
  email: string;
  displayName: string;
  /** False when the account was already an administrator (idempotent no-op). */
  changed: boolean;
  revokedSessions: number;
}

export async function promoteToAdmin(
  prisma: PrismaClient,
  options: PromoteOptions,
): Promise<PromoteResult> {
  if (options.nodeEnv === 'production' && options.bootstrapEnabled !== 'true') {
    throw new BootstrapError(
      'BOOTSTRAP_DISABLED',
      'Set ADMIN_BOOTSTRAP_ENABLED=true to promote an administrator in production.',
    );
  }
  const identifier = options.identifier.trim();
  if (identifier.length === 0) {
    throw new BootstrapError('INVALID_TARGET', 'Provide an account email or display name.');
  }

  // Case-insensitive match so an operator typo cannot silently elevate the
  // wrong account: an identifier matching more than one account is refused.
  const matches = await prisma.user.findMany({
    where: {
      OR: [
        { email: identifier.toLowerCase() },
        { displayName: { equals: identifier, mode: 'insensitive' } },
      ],
    },
  });
  if (matches.length === 0) {
    throw new BootstrapError('NOT_FOUND', `No account matches "${identifier}".`);
  }
  if (matches.length > 1) {
    throw new BootstrapError(
      'AMBIGUOUS_TARGET',
      `"${identifier}" matches multiple accounts; use the exact email.`,
    );
  }
  const user = matches[0]!;

  if (user.role === 'ADMIN') {
    // Idempotent: already an administrator, nothing to change or audit.
    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      changed: false,
      revokedSessions: 0,
    };
  }

  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    // Force a fresh login so the new role and a clean session take effect.
    const revoked = await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // SYSTEM bootstrap audit: the promoted user is both actor and target. No
    // secret is serialized.
    await tx.adminAuditLog.create({
      data: {
        actorUserId: user.id,
        actorSessionId: 'SYSTEM',
        actionNamespace: 'admin.bootstrap.promote',
        targetType: 'User',
        targetId: user.id,
        reason: 'Administrator promotion via admin:promote CLI',
        requestId: 'SYSTEM',
        idempotencyKey: `promote:${user.id}`,
        outcome: 'SUCCESS',
        afterJson: { role: 'ADMIN' },
      },
    });
    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      changed: true,
      revokedSessions: revoked.count,
    };
  });
}
