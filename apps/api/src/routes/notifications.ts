import fastifyWebsocket from '@fastify/websocket';
import { notificationsResponseSchema, okResponseSchema } from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { CharacterService } from '../domain/character/character-service.js';
import type { LiveHub } from '../domain/notification/live-hub.js';
import type { NotificationService } from '../domain/notification/notification-service.js';

interface NotificationRouteOptions {
  notificationService: NotificationService;
  characterService: CharacterService;
  liveHub: LiveHub;
  /** Origins allowed to upgrade the live socket (same list as CSRF). */
  allowedOrigins: ReadonlySet<string>;
}

/** Inbound frames are never expected; cap them hard (ws closes with 1009). */
const MAX_INBOUND_FRAME_BYTES = 4 * 1024;

export async function notificationRoutes(
  app: FastifyInstance,
  opts: NotificationRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { notificationService, characterService, liveHub, allowedOrigins } = opts;

  await app.register(fastifyWebsocket, { options: { maxPayload: MAX_INBOUND_FRAME_BYTES } });

  typed.get(
    '/notifications',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['notifications'],
        summary: 'Stored notifications (the source of truth) + unread count',
        response: { 200: notificationsResponseSchema },
      },
    },
    async (request) => notificationService.list(request.currentUser!.id),
  );

  typed.post(
    '/notifications/:id/read',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['notifications'],
        summary: 'Mark one notification read',
        params: z.object({ id: z.uuid() }),
        response: { 200: okResponseSchema },
      },
    },
    async (request) => notificationService.markRead(request.currentUser!.id, request.params.id),
  );

  typed.post(
    '/notifications/read-all',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['notifications'],
        summary: 'Mark every notification read',
        response: { 200: okResponseSchema },
      },
    },
    async (request) => notificationService.markAllRead(request.currentUser!.id),
  );

  // Optional live enhancement: authenticated sockets receive envelope events
  // ({"type":"sync"} nudges, chat.message.created invalidations) and refetch
  // over REST. Losing the socket costs latency only — polling remains the
  // fallback and persistence the source of truth. The upgrade validates the
  // cookie session (requireAuth) and the Origin header; inbound frames are
  // size-capped, connections are heartbeated, and slow consumers are
  // disconnected by the hub instead of buffering without bound.
  app.get(
    '/notifications/ws',
    {
      websocket: true,
      preHandler: [
        app.requireAuth,
        async (request, reply) => {
          const origin = request.headers.origin;
          if (typeof origin !== 'string' || !allowedOrigins.has(origin)) {
            return reply.status(403).send({
              error: {
                code: 'ORIGIN_FORBIDDEN',
                message: 'Request origin is missing or not allowed.',
                requestId: request.id,
              },
            });
          }
        },
      ],
    },
    (socket, request) => {
      void (async () => {
        try {
          const character = await characterService.requireCharacter(request.currentUser!.id);
          liveHub.add({
            characterId: character.id,
            sessionId: request.currentSession!.id,
            socket,
          });
          socket.on('close', () => liveHub.remove(socket));
        } catch {
          socket.close(1008, 'no character');
        }
      })();
    },
  );
}
