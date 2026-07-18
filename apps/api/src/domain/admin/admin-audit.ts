import { type AdminAuditLog, Prisma } from '@prisma/client';

/** The authenticated administrator performing a mutation. */
export interface AdminActor {
  userId: string;
  sessionId: string;
  requestId: string;
}

export interface AuditInput {
  actor: AdminActor;
  /** Dotted action namespace, e.g. "currency.adjust". */
  actionNamespace: string;
  targetType: string;
  targetId: string;
  reason: string;
  idempotencyKey: string;
  /** Allowlisted, secret-free snapshots (never full Prisma records). */
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/**
 * Writes one append-only AdminAuditLog row INSIDE the caller's transaction, so
 * the audit commits or rolls back atomically with the domain mutation. The
 * unique (actorUserId, actionNamespace, idempotencyKey) constraint doubles as
 * the admin idempotency key. before/after must be small allowlisted objects;
 * this domain never serializes complete records, secrets, or sessions.
 */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  input: AuditInput,
): Promise<AdminAuditLog> {
  return tx.adminAuditLog.create({
    data: {
      actorUserId: input.actor.userId,
      actorSessionId: input.actor.sessionId,
      actionNamespace: input.actionNamespace,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      requestId: input.actor.requestId,
      idempotencyKey: input.idempotencyKey,
      outcome: 'SUCCESS',
      beforeJson: input.before ?? Prisma.JsonNull,
      afterJson: input.after ?? Prisma.JsonNull,
    },
  });
}

/** True when a create error is a unique-constraint violation (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}
