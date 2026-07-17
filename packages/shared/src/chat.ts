import { z } from 'zod';

import { idempotencyKeySchema } from './travel.js';

/** Maximum message length in Unicode code points (server also caps bytes). */
export const CHAT_MESSAGE_MAX_CODE_POINTS = 500;
/** Maximum message length in UTF-8 bytes. */
export const CHAT_MESSAGE_MAX_BYTES = 2000;
/** Hard maximum page size for chat history requests. */
export const CHAT_HISTORY_MAX_LIMIT = 50;
/** Unread counts are capped at this value for display. */
export const CHAT_UNREAD_CAP = 99;

export const chatChannelKindSchema = z.enum(['GLOBAL', 'LOCATION']);
export type ChatChannelKind = z.infer<typeof chatChannelKindSchema>;

export const chatChannelSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  kind: chatChannelKindSchema,
  /** Display name ("Global" or the location's name). */
  name: z.string(),
  /** Set for LOCATION channels only. */
  locationSlug: z.string().nullable(),
  /** Unread messages, capped at CHAT_UNREAD_CAP for display. */
  unreadCount: z.number().int().min(0),
  /** True when unreadCount hit the display cap. */
  unreadCapped: z.boolean(),
});
export type ChatChannelView = z.infer<typeof chatChannelSchema>;

export const chatChannelsResponseSchema = z.object({
  channels: z.array(chatChannelSchema),
});
export type ChatChannelsResponse = z.infer<typeof chatChannelsResponseSchema>;

export const chatMessageSchema = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  author: z.object({
    characterId: z.uuid(),
    name: z.string(),
  }),
  /** Plain text. Clients must render it strictly as text. */
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export type ChatMessageView = z.infer<typeof chatMessageSchema>;

export const chatHistoryDirectionSchema = z.enum(['backward', 'forward']);
export type ChatHistoryDirection = z.infer<typeof chatHistoryDirectionSchema>;

export const chatMessagesQuerySchema = z.object({
  /** Opaque cursor from a previous response; omit for the newest page. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_HISTORY_MAX_LIMIT).default(30),
  /**
   * backward (default): messages older than the cursor, newest first.
   * forward: messages newer than the cursor, oldest first (gap-free polling
   * resumption; requires a cursor).
   */
  direction: chatHistoryDirectionSchema.default('backward'),
});
export type ChatMessagesQuery = z.infer<typeof chatMessagesQuerySchema>;

export const chatMessagesResponseSchema = z.object({
  /** backward pages are newest-first; forward pages are oldest-first. */
  messages: z.array(chatMessageSchema),
  /** Continuation cursor in the requested direction; null when exhausted. */
  nextCursor: z.string().nullable(),
  /**
   * Cursor of the newest message this character can currently see in the
   * channel (null when the channel is empty). Poll forward from here.
   */
  latestCursor: z.string().nullable(),
});
export type ChatMessagesResponse = z.infer<typeof chatMessagesResponseSchema>;

export const sendChatMessageRequestSchema = z.object({
  /** Plain text; the server normalizes line endings and trims whitespace. */
  body: z.string().min(1).max(CHAT_MESSAGE_MAX_BYTES),
  idempotencyKey: idempotencyKeySchema,
});
export type SendChatMessageRequest = z.infer<typeof sendChatMessageRequestSchema>;

export const sendChatMessageResponseSchema = z.object({
  message: chatMessageSchema,
});
export type SendChatMessageResponse = z.infer<typeof sendChatMessageResponseSchema>;

export const chatMarkReadRequestSchema = z.object({
  /** Read state advances to this message (never backward). */
  messageId: z.uuid(),
});
export type ChatMarkReadRequest = z.infer<typeof chatMarkReadRequestSchema>;

export const chatBlockSchema = z.object({
  characterId: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
});
export type ChatBlockView = z.infer<typeof chatBlockSchema>;

export const chatBlocksResponseSchema = z.object({
  blocks: z.array(chatBlockSchema),
});
export type ChatBlocksResponse = z.infer<typeof chatBlocksResponseSchema>;

export const chatReportReasonSchema = z.enum([
  'HARASSMENT',
  'SPAM',
  'ABUSIVE_LANGUAGE',
  'CHEATING_OR_EXPLOITS',
  'OTHER',
]);
export type ChatReportReason = z.infer<typeof chatReportReasonSchema>;

export const createChatReportRequestSchema = z.object({
  reason: chatReportReasonSchema,
  /** Optional bounded free-text details. */
  details: z.string().trim().max(500).optional(),
});
export type CreateChatReportRequest = z.infer<typeof createChatReportRequestSchema>;

/**
 * Live-socket invalidation for a committed chat message. Content is never
 * pushed: clients fetch messages through the authorized REST API.
 */
export const chatMessageCreatedEventSchema = z.object({
  type: z.literal('chat.message.created'),
  eventId: z.uuid(),
  channelId: z.uuid(),
  messageId: z.uuid(),
  occurredAt: z.iso.datetime(),
});
export type ChatMessageCreatedEvent = z.infer<typeof chatMessageCreatedEventSchema>;
