import {
  characterClassListSchema,
  characterResponseSchema,
  characterStatsResponseSchema,
  createCharacterRequestSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { CharacterService } from '../domain/character/character-service.js';

interface CharacterRouteOptions {
  characterService: CharacterService;
}

export async function characterRoutes(
  app: FastifyInstance,
  opts: CharacterRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { characterService } = opts;

  typed.get(
    '/characters/classes',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['characters'],
        summary: 'List playable classes',
        response: { 200: characterClassListSchema },
      },
    },
    async () => characterService.listClasses(),
  );

  typed.post(
    '/characters',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['characters'],
        summary: 'Create the account character (one per account)',
        body: createCharacterRequestSchema,
        response: { 201: characterResponseSchema },
      },
    },
    async (request, reply) => {
      const character = await characterService.createCharacter(
        request.currentUser!.id,
        request.body,
      );
      return reply.status(201).send(character);
    },
  );

  typed.get(
    '/characters/me',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['characters'],
        summary: 'Current character summary',
        response: { 200: characterResponseSchema },
      },
    },
    async (request) => characterService.getCharacterResponse(request.currentUser!.id),
  );

  typed.get(
    '/characters/me/stats',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['characters'],
        summary: 'Derived attributes and resources',
        response: { 200: characterStatsResponseSchema },
      },
    },
    async (request) => characterService.getStatsResponse(request.currentUser!.id),
  );
}
