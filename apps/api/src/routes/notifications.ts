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
}

export async function notificationRoutes(
  app: FastifyInstance,
  opts: NotificationRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { notificationService, characterService, liveHub } = opts;

  await app.register(fastifyWebsocket);

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

  // Optional live enhancement: authenticated sockets receive {"type":"sync"}
  // nudges and refetch over REST. Losing the socket costs latency only —
  // polling remains the fallback and persistence the source of truth.
  app.get(
    '/notifications/ws',
    { websocket: true, preHandler: app.requireAuth },
    (socket, request) => {
      void (async () => {
        try {
          const character = await characterService.requireCharacter(request.currentUser!.id);
          liveHub.add(character.id, socket);
          socket.on('close', () => liveHub.remove(character.id, socket));
        } catch {
          socket.close(1008, 'no character');
        }
      })();
    },
  );
}
