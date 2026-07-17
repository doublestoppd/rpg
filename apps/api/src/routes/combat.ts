import {
  combatCommandRequestSchema,
  combatViewSchema,
  encountersResponseSchema,
  startCombatRequestSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { CombatService } from '../domain/combat/combat-service.js';

interface CombatRouteOptions {
  combatService: CombatService;
}

export async function combatRoutes(app: FastifyInstance, opts: CombatRouteOptions): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { combatService } = opts;

  typed.get(
    '/combat/encounters',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['combat'],
        summary: 'Encounters at the current location + any active combat',
        response: { 200: encountersResponseSchema },
      },
    },
    async (request) => combatService.getEncounters(request.currentUser!.id),
  );

  typed.post(
    '/combat/start',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['combat'],
        summary: 'Start a persisted server-authoritative combat',
        body: startCombatRequestSchema,
        response: { 200: combatViewSchema },
      },
    },
    async (request) => combatService.start(request.currentUser!.id, request.body),
  );

  typed.get(
    '/combat/:id',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['combat'],
        summary: 'Full combat state (refresh-safe)',
        params: z.object({ id: z.uuid() }),
        response: { 200: combatViewSchema },
      },
    },
    async (request) => combatService.getCombat(request.currentUser!.id, request.params.id),
  );

  typed.post(
    '/combat/:id/commands',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['combat'],
        summary: 'Resolve one command (locked, versioned, idempotent-safe)',
        params: z.object({ id: z.uuid() }),
        body: combatCommandRequestSchema,
        response: { 200: combatViewSchema },
      },
    },
    async (request) =>
      combatService.command(request.currentUser!.id, request.params.id, request.body),
  );
}
