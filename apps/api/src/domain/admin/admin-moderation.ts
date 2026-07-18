import type { PrismaClient } from '@prisma/client';
import type {
  AdminChatReport,
  AdminChatReportsQuery,
  AdminChatReportsResponse,
  AdminModerationResponse,
  AdminRestrictionResponse,
} from '@rpg/shared';

import { conflict, DomainError } from '../../lib/http-errors.js';
import { type AdminActor, isUniqueViolation, writeAudit } from './admin-audit.js';
import { decodeCursor, encodeCursor } from './admin-cursor.js';

/** Fixed tombstone shown in place of a redacted message body. */
export const REDACTION_TOMBSTONE = '[message removed by a moderator]';

const unknownReport = () => new DomainError(404, 'UNKNOWN_REPORT', 'No such report.');
const unknownMessage = () => new DomainError(404, 'UNKNOWN_MESSAGE', 'No such message.');
const unknownRestriction = () =>
  new DomainError(404, 'UNKNOWN_RESTRICTION', 'No such restriction.');

/**
 * Administrative chat moderation: report triage, redaction (tombstone, never
 * hard delete), restrictions, and revocation. Every mutation writes both an
 * AdminAuditLog row and a ChatModerationAction record in the same transaction,
 * and is idempotent per actor + namespace + key. Reporter identity is never
 * returned.
 */
export interface AdminModerationService {
  listReports(query: AdminChatReportsQuery): Promise<AdminChatReportsResponse>;
  resolveReport(
    actor: AdminActor,
    reportId: string,
    input: { resolution: 'RESOLVED' | 'DISMISSED'; reason: string; idempotencyKey: string },
  ): Promise<AdminModerationResponse>;
  redactMessage(
    actor: AdminActor,
    messageId: string,
    input: { reason: string; idempotencyKey: string },
  ): Promise<AdminModerationResponse>;
  createRestriction(
    actor: AdminActor,
    input: {
      characterId: string;
      reason: string;
      expiresAt?: string | undefined;
      idempotencyKey: string;
    },
  ): Promise<AdminRestrictionResponse>;
  revokeRestriction(
    actor: AdminActor,
    restrictionId: string,
    input: { reason: string; idempotencyKey: string },
  ): Promise<AdminModerationResponse>;
}

export function createAdminModerationService(prisma: PrismaClient): AdminModerationService {
  async function findAudit(actor: AdminActor, namespace: string, key: string) {
    return prisma.adminAuditLog.findUnique({
      where: {
        actorUserId_actionNamespace_idempotencyKey: {
          actorUserId: actor.userId,
          actionNamespace: namespace,
          idempotencyKey: key,
        },
      },
    });
  }

  return {
    async listReports(query) {
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const createdAtFilter = cursor?.c ? { lt: new Date(cursor.c) } : undefined;
      const rows = await prisma.chatReport.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
        },
        include: {
          message: { select: { redactedAt: true, channel: { select: { slug: true } } } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      // Resolve author names for the snapshot authors (evidence display).
      const authorIds = [...new Set(rows.map((r) => r.snapshotAuthorCharacterId))];
      const authors = await prisma.character.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, name: true },
      });
      const nameById = new Map(authors.map((a) => [a.id, a.name]));
      const last = rows.at(-1);
      const reports: AdminChatReport[] = rows.map((row) => ({
        id: row.id,
        reason: row.reason,
        details: row.details,
        status: row.status,
        snapshotBody: row.snapshotBody,
        snapshotAuthorCharacterId: row.snapshotAuthorCharacterId,
        snapshotAuthorName: nameById.get(row.snapshotAuthorCharacterId) ?? 'Unknown',
        messageId: row.messageId,
        channelSlug: row.message.channel.slug,
        messageRedactedAt: row.message.redactedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        resolutionReason: row.resolutionReason,
        // reporterCharacterId deliberately omitted: reporter privacy.
      }));
      return {
        reports,
        nextCursor:
          rows.length === query.limit && last
            ? encodeCursor({ c: last.createdAt.toISOString() })
            : null,
      };
    },

    async resolveReport(actor, reportId, input) {
      const namespace = 'chat.report.resolve';
      const existing = await findAudit(actor, namespace, input.idempotencyKey);
      if (existing) return { auditId: existing.id };
      const report = await prisma.chatReport.findUnique({ where: { id: reportId } });
      if (!report) throw unknownReport();

      try {
        return await prisma.$transaction(async (tx) => {
          const updated = await tx.chatReport.updateMany({
            where: { id: reportId, status: 'OPEN' },
            data: {
              status: input.resolution,
              resolvedAt: new Date(),
              resolvedByUserId: actor.userId,
              resolutionReason: input.reason,
            },
          });
          if (updated.count === 0) {
            throw conflict('ALREADY_RESOLVED', 'That report has already been resolved.');
          }
          await tx.chatModerationAction.create({
            data: {
              actorUserId: actor.userId,
              action: 'RESOLVE_REPORT',
              subjectCharacterId: report.snapshotAuthorCharacterId,
              messageId: report.messageId,
              reportId: report.id,
              reason: input.reason,
            },
          });
          const audit = await writeAudit(tx, {
            actor,
            actionNamespace: namespace,
            targetType: 'ChatReport',
            targetId: reportId,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            after: { resolution: input.resolution },
          });
          return { auditId: audit.id };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const replay = await findAudit(actor, namespace, input.idempotencyKey);
          if (replay) return { auditId: replay.id };
        }
        throw error;
      }
    },

    async redactMessage(actor, messageId, input) {
      const namespace = 'chat.message.redact';
      const existing = await findAudit(actor, namespace, input.idempotencyKey);
      if (existing) return { auditId: existing.id };
      const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
      if (!message) throw unknownMessage();

      try {
        return await prisma.$transaction(async (tx) => {
          // Tombstone: keep id/author/channel/ordering; replace only the body.
          // Report snapshots and audit evidence are untouched; never hard-delete.
          const now = new Date();
          const updated = await tx.chatMessage.updateMany({
            where: { id: messageId, redactedAt: null },
            data: {
              body: REDACTION_TOMBSTONE,
              redactedAt: now,
              redactedByUserId: actor.userId,
              redactionReason: input.reason,
            },
          });
          if (updated.count === 0) {
            throw conflict('ALREADY_REDACTED', 'That message has already been redacted.');
          }
          await tx.chatModerationAction.create({
            data: {
              actorUserId: actor.userId,
              action: 'REDACT_MESSAGE',
              subjectCharacterId: message.authorCharacterId,
              messageId: message.id,
              reason: input.reason,
            },
          });
          const audit = await writeAudit(tx, {
            actor,
            actionNamespace: namespace,
            targetType: 'ChatMessage',
            targetId: messageId,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            after: { redacted: true },
          });
          return { auditId: audit.id };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const replay = await findAudit(actor, namespace, input.idempotencyKey);
          if (replay) return { auditId: replay.id };
        }
        throw error;
      }
    },

    async createRestriction(actor, input) {
      const namespace = 'chat.restriction.create';
      const existing = await findAudit(actor, namespace, input.idempotencyKey);
      if (existing) {
        const after = (existing.afterJson ?? {}) as { restrictionId?: string };
        return { restrictionId: after.restrictionId ?? '', auditId: existing.id };
      }
      const character = await prisma.character.findUnique({ where: { id: input.characterId } });
      if (!character) throw new DomainError(404, 'UNKNOWN_CHARACTER', 'No such character.');

      try {
        return await prisma.$transaction(async (tx) => {
          const restriction = await tx.chatRestriction.create({
            data: {
              characterId: input.characterId,
              status: 'ACTIVE',
              reason: input.reason,
              expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            },
          });
          await tx.chatModerationAction.create({
            data: {
              actorUserId: actor.userId,
              action: 'APPLY_RESTRICTION',
              subjectCharacterId: input.characterId,
              restrictionId: restriction.id,
              reason: input.reason,
            },
          });
          const audit = await writeAudit(tx, {
            actor,
            actionNamespace: namespace,
            targetType: 'Character',
            targetId: input.characterId,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            after: { restrictionId: restriction.id, expiresAt: input.expiresAt ?? null },
          });
          return { restrictionId: restriction.id, auditId: audit.id };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const replay = await findAudit(actor, namespace, input.idempotencyKey);
          if (replay) {
            const after = (replay.afterJson ?? {}) as { restrictionId?: string };
            return { restrictionId: after.restrictionId ?? '', auditId: replay.id };
          }
        }
        throw error;
      }
    },

    async revokeRestriction(actor, restrictionId, input) {
      const namespace = 'chat.restriction.revoke';
      const existing = await findAudit(actor, namespace, input.idempotencyKey);
      if (existing) return { auditId: existing.id };
      const restriction = await prisma.chatRestriction.findUnique({ where: { id: restrictionId } });
      if (!restriction) throw unknownRestriction();

      try {
        return await prisma.$transaction(async (tx) => {
          const updated = await tx.chatRestriction.updateMany({
            where: { id: restrictionId, status: 'ACTIVE' },
            data: { status: 'REVOKED', revokedAt: new Date() },
          });
          if (updated.count === 0) {
            throw conflict('ALREADY_REVOKED', 'That restriction is not active.');
          }
          await tx.chatModerationAction.create({
            data: {
              actorUserId: actor.userId,
              action: 'REVOKE_RESTRICTION',
              subjectCharacterId: restriction.characterId,
              restrictionId: restriction.id,
              reason: input.reason,
            },
          });
          const audit = await writeAudit(tx, {
            actor,
            actionNamespace: namespace,
            targetType: 'ChatRestriction',
            targetId: restrictionId,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
            after: { revoked: true },
          });
          return { auditId: audit.id };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const replay = await findAudit(actor, namespace, input.idempotencyKey);
          if (replay) return { auditId: replay.id };
        }
        throw error;
      }
    },
  };
}
