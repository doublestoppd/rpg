import {
  chatBlocksResponseSchema,
  chatChannelsResponseSchema,
  chatMarkReadRequestSchema,
  chatMessagesQuerySchema,
  chatMessagesResponseSchema,
  createChatReportRequestSchema,
  okResponseSchema,
  sendChatMessageRequestSchema,
  sendChatMessageResponseSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { ChatService } from '../domain/chat/chat-service.js';

interface ChatRouteOptions {
  chatService: ChatService;
}

export async function chatRoutes(app: FastifyInstance, opts: ChatRouteOptions): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { chatService } = opts;

  typed.get(
    '/chat/channels',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['chat'],
        summary: 'Channels this character may currently access, with unread counts',
        response: { 200: chatChannelsResponseSchema },
      },
    },
    async (request) => chatService.listChannels(request.currentUser!.id),
  );

  typed.get(
    '/chat/channels/:channelId/messages',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['chat'],
        summary: 'Cursor-paginated channel history (opaque, stable cursors)',
        params: z.object({ channelId: z.uuid() }),
        querystring: chatMessagesQuerySchema,
        response: { 200: chatMessagesResponseSchema },
      },
    },
    async (request) =>
      chatService.getMessages(request.currentUser!.id, request.params.channelId, request.query),
  );

  typed.post(
    '/chat/channels/:channelId/messages',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['chat'],
        summary: 'Send one plain-text message (idempotent per author + key)',
        params: z.object({ channelId: z.uuid() }),
        body: sendChatMessageRequestSchema,
        response: { 201: sendChatMessageResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await chatService.sendMessage(
        request.currentUser!.id,
        request.params.channelId,
        request.body,
        request.ip,
      );
      return reply.status(201).send(result);
    },
  );

  typed.post(
    '/chat/channels/:channelId/read',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['chat'],
        summary: 'Advance read state to a real message (never backward)',
        params: z.object({ channelId: z.uuid() }),
        body: chatMarkReadRequestSchema,
        response: { 200: okResponseSchema },
      },
    },
    async (request) =>
      chatService.markRead(request.currentUser!.id, request.params.channelId, request.body),
  );

  typed.get(
    '/chat/blocks',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['chat'],
        summary: 'Characters this character has blocked',
        response: { 200: chatBlocksResponseSchema },
      },
    },
    async (request) => chatService.listBlocks(request.currentUser!.id),
  );

  typed.put(
    '/chat/blocks/:characterId',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['chat'],
        summary: 'Block a character (unilateral, idempotent, invisible to them)',
        params: z.object({ characterId: z.uuid() }),
        response: { 200: okResponseSchema },
      },
    },
    async (request) => chatService.createBlock(request.currentUser!.id, request.params.characterId),
  );

  typed.delete(
    '/chat/blocks/:characterId',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['chat'],
        summary: 'Remove a block',
        params: z.object({ characterId: z.uuid() }),
        response: { 200: okResponseSchema },
      },
    },
    async (request) => chatService.removeBlock(request.currentUser!.id, request.params.characterId),
  );

  typed.post(
    '/chat/messages/:messageId/reports',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['chat'],
        summary: 'Report a message (one per reporter and message, snapshotted)',
        params: z.object({ messageId: z.uuid() }),
        body: createChatReportRequestSchema,
        response: { 201: okResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await chatService.createReport(
        request.currentUser!.id,
        request.params.messageId,
        request.body,
      );
      return reply.status(201).send(result);
    },
  );
}
