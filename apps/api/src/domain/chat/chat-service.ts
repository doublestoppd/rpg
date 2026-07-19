import type { ChatChannel, ChatMessage, Prisma, PrismaClient } from '@prisma/client';
import {
  CHAT_UNREAD_CAP,
  type ChatBlocksResponse,
  type ChatChannelsResponse,
  type ChatChannelView,
  type ChatMessagesQuery,
  type ChatMessagesResponse,
  type ChatMessageView,
  type ChatReportReason,
  type OkResponse,
  type SendChatMessageResponse,
} from '@rpg/shared';

import { conflict, DomainError, forbidden, RateLimitError } from '../../lib/http-errors.js';
import { metrics } from '../../lib/metrics.js';
import type { TimedStateRunner } from '../../lib/timed-state.js';
import type { CharacterService } from '../character/character-service.js';
import { decodeChatCursor, encodeChatCursor } from './chat-cursor.js';
import type { ChatLive } from './chat-live.js';
import type { ChatRateLimiter } from './chat-rate-limit.js';
import { normalizeChatBody } from './chat-text.js';

const unknownChannel = () => new DomainError(404, 'UNKNOWN_CHANNEL', 'No such chat channel.');
const unknownMessage = () => new DomainError(404, 'UNKNOWN_MESSAGE', 'No such chat message.');
const channelForbidden = () => {
  metrics.increment('chat_authorization_rejected');
  return forbidden('CHANNEL_FORBIDDEN', 'You are not present in this channel.');
};

type MessageWithAuthor = ChatMessage & { author: { id: string; name: string } };

export interface ChatService {
  listChannels(userId: string): Promise<ChatChannelsResponse>;
  getMessages(
    userId: string,
    channelId: string,
    query: ChatMessagesQuery,
  ): Promise<ChatMessagesResponse>;
  sendMessage(
    userId: string,
    channelId: string,
    input: { body: string; idempotencyKey: string },
    clientIp: string,
  ): Promise<SendChatMessageResponse>;
  markRead(userId: string, channelId: string, input: { messageId: string }): Promise<OkResponse>;
  listBlocks(userId: string): Promise<ChatBlocksResponse>;
  createBlock(userId: string, blockedCharacterId: string): Promise<OkResponse>;
  removeBlock(userId: string, blockedCharacterId: string): Promise<OkResponse>;
  createReport(
    userId: string,
    messageId: string,
    input: { reason: ChatReportReason; details?: string | undefined },
  ): Promise<OkResponse>;
}

export function createChatService(
  prisma: PrismaClient,
  characterService: CharacterService,
  timedStateRunner: TimedStateRunner,
  rateLimiter: ChatRateLimiter,
  chatLive: ChatLive,
): ChatService {
  /**
   * The character's authoritative current location after lazy timed-state
   * finalization (ADR 0004). Null while traveling: a traveling character has
   * no location-chat membership.
   */
  async function resolveCurrentLocationId(characterId: string): Promise<string | null> {
    await timedStateRunner.finalizeAll(characterId);
    const fresh = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { currentLocationId: true },
    });
    return fresh.currentLocationId;
  }

  /** The channel, if this character may currently read/send in it. */
  async function requireChannelAccess(
    characterId: string,
    channelId: string,
  ): Promise<ChatChannel> {
    const channel = await prisma.chatChannel.findUnique({ where: { id: channelId } });
    if (!channel) throw unknownChannel();
    if (channel.kind === 'GLOBAL') return channel;
    const locationId = await resolveCurrentLocationId(characterId);
    if (!locationId || locationId !== channel.locationId) throw channelForbidden();
    return channel;
  }

  async function assertNotRestricted(characterId: string, now: Date): Promise<void> {
    const active = await prisma.chatRestriction.findFirst({
      where: {
        characterId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    if (active) {
      metrics.increment('chat_authorization_rejected');
      throw forbidden('CHAT_RESTRICTED', 'Your chat privileges are currently restricted.');
    }
  }

  async function blockedCharacterIds(characterId: string): Promise<string[]> {
    const blocks = await prisma.chatBlock.findMany({
      where: { blockerCharacterId: characterId },
      select: { blockedCharacterId: true },
    });
    return blocks.map((b) => b.blockedCharacterId);
  }

  function toMessageView(row: MessageWithAuthor): ChatMessageView {
    return {
      id: row.id,
      channelId: row.channelId,
      author: { characterId: row.author.id, name: row.author.name },
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Ordering-tuple filter: messages strictly after/before (createdAt, id). */
  function tupleFilter(
    cursor: { createdAt: Date; id: string },
    side: 'gt' | 'lt',
  ): Prisma.ChatMessageWhereInput {
    return {
      OR: [
        { createdAt: { [side]: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { [side]: cursor.id } },
      ],
    };
  }

  async function unreadFor(
    characterId: string,
    channelId: string,
    blockedIds: string[],
  ): Promise<{ unreadCount: number; unreadCapped: boolean }> {
    const readState = await prisma.chatChannelReadState.findUnique({
      where: { characterId_channelId: { characterId, channelId } },
    });
    const rows = await prisma.chatMessage.findMany({
      where: {
        channelId,
        authorCharacterId: { notIn: [characterId, ...blockedIds] },
        ...(readState
          ? tupleFilter(
              {
                createdAt: readState.lastReadMessageCreatedAt,
                id: readState.lastReadMessageId,
              },
              'gt',
            )
          : {}),
      },
      select: { id: true },
      take: CHAT_UNREAD_CAP + 1,
    });
    return {
      unreadCount: Math.min(rows.length, CHAT_UNREAD_CAP),
      unreadCapped: rows.length > CHAT_UNREAD_CAP,
    };
  }

  async function toChannelView(
    channel: ChatChannel & { location: { slug: string; name: string } | null },
    characterId: string,
    blockedIds: string[],
  ): Promise<ChatChannelView> {
    const unread = await unreadFor(characterId, channel.id, blockedIds);
    return {
      id: channel.id,
      slug: channel.slug,
      kind: channel.kind,
      name: channel.kind === 'GLOBAL' ? 'Global' : (channel.location?.name ?? channel.slug),
      locationSlug: channel.location?.slug ?? null,
      ...unread,
    };
  }

  return {
    async listChannels(userId) {
      const character = await characterService.requireCharacter(userId);
      const locationId = await resolveCurrentLocationId(character.id);
      const channels = await prisma.chatChannel.findMany({
        where: {
          OR: [{ kind: 'GLOBAL' }, ...(locationId ? [{ locationId }] : [])],
        },
        include: { location: { select: { slug: true, name: true } } },
        orderBy: { kind: 'asc' },
      });
      const blockedIds = await blockedCharacterIds(character.id);
      return {
        channels: await Promise.all(
          channels.map((channel) => toChannelView(channel, character.id, blockedIds)),
        ),
      };
    },

    async getMessages(userId, channelId, query) {
      const character = await characterService.requireCharacter(userId);
      const channel = await requireChannelAccess(character.id, channelId);
      const blockedIds = await blockedCharacterIds(character.id);
      const visibleWhere: Prisma.ChatMessageWhereInput = {
        channelId: channel.id,
        ...(blockedIds.length > 0 ? { authorCharacterId: { notIn: blockedIds } } : {}),
      };

      const cursor = query.cursor ? decodeChatCursor(query.cursor) : null;
      if (query.direction === 'forward' && !cursor) {
        throw new DomainError(400, 'CURSOR_REQUIRED', 'Forward polling requires a cursor.');
      }

      const rows = await prisma.chatMessage.findMany({
        where: {
          ...visibleWhere,
          ...(cursor ? tupleFilter(cursor, query.direction === 'forward' ? 'gt' : 'lt') : {}),
        },
        include: { author: { select: { id: true, name: true } } },
        orderBy:
          query.direction === 'forward'
            ? [{ createdAt: 'asc' }, { id: 'asc' }]
            : [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });

      const newest = await prisma.chatMessage.findFirst({
        where: visibleWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, createdAt: true },
      });

      if (query.direction === 'forward' && rows.length > 0) {
        // Messages recovered without a socket: the polling fallback worked.
        metrics.increment('chat_polling_recovery');
      }

      const last = rows.at(-1);
      return {
        messages: rows.map(toMessageView),
        nextCursor:
          rows.length === query.limit && last
            ? encodeChatCursor({ createdAt: last.createdAt, id: last.id })
            : null,
        latestCursor: newest ? encodeChatCursor(newest) : null,
      };
    },

    async sendMessage(userId, channelId, input, clientIp) {
      const now = new Date();
      const character = await characterService.requireCharacter(userId);

      // Same author + key: return the original message, send nothing again.
      const existing = await prisma.chatMessage.findUnique({
        where: {
          authorCharacterId_idempotencyKey: {
            authorCharacterId: character.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
        include: { author: { select: { id: true, name: true } } },
      });
      if (existing) {
        metrics.increment('chat_idempotency_replay');
        return { message: toMessageView(existing) };
      }

      const body = normalizeChatBody(input.body);
      await assertNotRestricted(character.id, now);

      const decision = rateLimiter.consume(character.id, clientIp, now);
      if (!decision.allowed) {
        metrics.increment('chat_rate_limited');
        throw new RateLimitError(
          'CHAT_RATE_LIMITED',
          'You are sending messages too quickly.',
          decision.retryAfterSeconds,
        );
      }

      const channel = await requireChannelAccess(character.id, channelId);

      let created: MessageWithAuthor;
      try {
        created = await prisma.chatMessage.create({
          data: {
            channelId: channel.id,
            authorCharacterId: character.id,
            body,
            idempotencyKey: input.idempotencyKey,
          },
          include: { author: { select: { id: true, name: true } } },
        });
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          // A concurrent request with the same key won: exactly one row
          // exists and exactly one live invalidation was emitted (by the
          // winner). Return the winning message.
          metrics.increment('concurrency_conflict');
          metrics.increment('chat_idempotency_replay');
          const winner = await prisma.chatMessage.findUniqueOrThrow({
            where: {
              authorCharacterId_idempotencyKey: {
                authorCharacterId: character.id,
                idempotencyKey: input.idempotencyKey,
              },
            },
            include: { author: { select: { id: true, name: true } } },
          });
          return { message: toMessageView(winner) };
        }
        throw error;
      }

      metrics.increment('chat_message_accepted');
      // The row is committed; broadcasting is a best-effort hint on top.
      await chatLive.publish({
        channelId: channel.id,
        messageId: created.id,
        authorCharacterId: character.id,
        occurredAt: created.createdAt.toISOString(),
      });
      return { message: toMessageView(created) };
    },

    async markRead(userId, channelId, input) {
      const character = await characterService.requireCharacter(userId);
      const channel = await requireChannelAccess(character.id, channelId);
      const message = await prisma.chatMessage.findUnique({ where: { id: input.messageId } });
      if (!message || message.channelId !== channel.id) throw unknownMessage();

      const forward = {
        lastReadMessageId: message.id,
        lastReadMessageCreatedAt: message.createdAt,
      };
      // Forward-only: the conditional update ignores stale (older) marks even
      // under concurrent requests; creation races fall back to the update.
      const updated = await prisma.chatChannelReadState.updateMany({
        where: {
          characterId: character.id,
          channelId: channel.id,
          OR: [
            { lastReadMessageCreatedAt: { lt: message.createdAt } },
            { lastReadMessageCreatedAt: message.createdAt, lastReadMessageId: { lt: message.id } },
          ],
        },
        data: forward,
      });
      if (updated.count === 0) {
        const existing = await prisma.chatChannelReadState.findUnique({
          where: {
            characterId_channelId: { characterId: character.id, channelId: channel.id },
          },
        });
        if (!existing) {
          try {
            await prisma.chatChannelReadState.create({
              data: { characterId: character.id, channelId: channel.id, ...forward },
            });
          } catch (error) {
            if (
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              (error as { code?: string }).code === 'P2002'
            ) {
              metrics.increment('concurrency_conflict');
            } else {
              throw error;
            }
          }
        }
      }
      return { ok: true };
    },

    async listBlocks(userId) {
      const character = await characterService.requireCharacter(userId);
      const blocks = await prisma.chatBlock.findMany({
        where: { blockerCharacterId: character.id },
        include: { blocked: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return {
        blocks: blocks.map((block) => ({
          characterId: block.blocked.id,
          name: block.blocked.name,
          createdAt: block.createdAt.toISOString(),
        })),
      };
    },

    async createBlock(userId, blockedCharacterId) {
      const character = await characterService.requireCharacter(userId);
      if (blockedCharacterId === character.id) {
        throw new DomainError(400, 'CANNOT_BLOCK_SELF', 'You cannot block yourself.');
      }
      const target = await prisma.character.findUnique({ where: { id: blockedCharacterId } });
      if (!target) throw new DomainError(404, 'UNKNOWN_CHARACTER', 'No such character.');
      // Idempotent: blocking twice is a silent no-op.
      await prisma.chatBlock.createMany({
        data: { blockerCharacterId: character.id, blockedCharacterId },
        skipDuplicates: true,
      });
      return { ok: true };
    },

    async removeBlock(userId, blockedCharacterId) {
      const character = await characterService.requireCharacter(userId);
      await prisma.chatBlock.deleteMany({
        where: { blockerCharacterId: character.id, blockedCharacterId },
      });
      return { ok: true };
    },

    async createReport(userId, messageId, input) {
      const character = await characterService.requireCharacter(userId);
      const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
      if (!message) throw unknownMessage();
      if (message.authorCharacterId === character.id) {
        throw new DomainError(400, 'CANNOT_REPORT_SELF', 'You cannot report your own message.');
      }
      try {
        await prisma.chatReport.create({
          data: {
            reporterCharacterId: character.id,
            messageId: message.id,
            reason: input.reason,
            details: input.details ?? null,
            // Immutable evidence snapshot: survives retention cleanup and any
            // later redaction of the live message row.
            snapshotBody: message.body,
            snapshotAuthorCharacterId: message.authorCharacterId,
            snapshotChannelId: message.channelId,
          },
        });
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          throw conflict('ALREADY_REPORTED', 'You have already reported this message.');
        }
        throw error;
      }
      metrics.increment('chat_report_created');
      return { ok: true };
    },
  };
}
