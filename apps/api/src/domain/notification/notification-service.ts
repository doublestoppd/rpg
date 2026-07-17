import type { Notification, Prisma, PrismaClient } from '@prisma/client';
import type { NotificationsResponse, NotificationTypeValue } from '@rpg/shared';
import { z } from 'zod';

import { DomainError } from '../../lib/http-errors.js';
import type { CharacterService } from '../character/character-service.js';

/** Validated shape of Notification.payload (stored JSON). */
const payloadSchema = z.object({ title: z.string(), body: z.string() });

export interface CreateNotificationInput {
  characterId: string;
  type: NotificationTypeValue;
  /** Domain-event key (unique per character): "travel:<id>", "quest:<id>"… */
  dedupeKey: string;
  title: string;
  body: string;
}

/**
 * Write-side sink used by gameplay services INSIDE their own transactions,
 * mirroring the quest event sink. Creation is idempotent per character +
 * dedupeKey, so a worker job and a lazy finalizer racing over the same
 * domain event still produce exactly one notification.
 */
export interface NotificationSink {
  create(tx: Prisma.TransactionClient, input: CreateNotificationInput): Promise<void>;
}

/** Default sink for tests/bootstraps that do not wire notifications. */
export const noopNotifications: NotificationSink = {
  create: async () => undefined,
};

/** Best-effort live nudge (WebSocket); persistence is the source of truth. */
export interface LivePoke {
  poke(characterId: string): void;
}

export interface NotificationService extends NotificationSink {
  list(userId: string): Promise<NotificationsResponse>;
  markRead(userId: string, notificationId: string): Promise<{ ok: true }>;
  markAllRead(userId: string): Promise<{ ok: true }>;
}

const LIST_LIMIT = 50;

export function createNotificationService(
  prisma: PrismaClient,
  characterService: CharacterService,
  live: LivePoke = { poke: () => undefined },
): NotificationService {
  function toView(row: Notification) {
    const payload = payloadSchema.parse(row.payload);
    return {
      id: row.id,
      type: row.type as NotificationTypeValue,
      title: payload.title,
      body: payload.body,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  return {
    async create(tx, input) {
      // skipDuplicates makes the unique (characterId, dedupeKey) constraint
      // an idempotency key instead of an error: replays are silent no-ops.
      const created = await tx.notification.createMany({
        data: {
          characterId: input.characterId,
          type: input.type,
          dedupeKey: input.dedupeKey,
          payload: { title: input.title, body: input.body },
        },
        skipDuplicates: true,
      });
      if (created.count === 1) {
        // Nudge live sockets after the current tick. Best-effort by design:
        // the transaction may not have committed yet, and the client's
        // refetch-on-poke plus regular polling both read committed state.
        setImmediate(() => live.poke(input.characterId));
      }
    },

    async list(userId) {
      const character = await characterService.requireCharacter(userId);
      const [rows, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where: { characterId: character.id },
          orderBy: { createdAt: 'desc' },
          take: LIST_LIMIT,
        }),
        prisma.notification.count({ where: { characterId: character.id, readAt: null } }),
      ]);
      return { notifications: rows.map(toView), unreadCount };
    },

    async markRead(userId, notificationId) {
      const character = await characterService.requireCharacter(userId);
      const updated = await prisma.notification.updateMany({
        where: { id: notificationId, characterId: character.id, readAt: null },
        data: { readAt: new Date() },
      });
      if (updated.count === 0) {
        const exists = await prisma.notification.findFirst({
          where: { id: notificationId, characterId: character.id },
        });
        if (!exists) throw new DomainError(404, 'UNKNOWN_NOTIFICATION', 'No such notification.');
      }
      return { ok: true };
    },

    async markAllRead(userId) {
      const character = await characterService.requireCharacter(userId);
      await prisma.notification.updateMany({
        where: { characterId: character.id, readAt: null },
        data: { readAt: new Date() },
      });
      return { ok: true };
    },
  };
}
