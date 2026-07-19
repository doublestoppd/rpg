import {
  characterBuildResponseSchema,
  chooseTalentRequestSchema,
  respecRequestSchema,
  setLoadoutRequestSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { BuildService } from '../domain/character/build-service.js';

interface BuildRouteOptions {
  buildService: BuildService;
}

/**
 * Character build routes (Phase 23): view the ability roster and talents, set a
 * bounded loadout, choose talents at unlocked tiers, and respec at a trainer
 * for a ledger-audited Gold fee. Changes never affect a battle already underway
 * (combat snapshots the build at start).
 */
export async function buildRoutes(app: FastifyInstance, opts: BuildRouteOptions): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { buildService } = opts;

  typed.get(
    '/builds/me',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['builds'],
        summary: 'The character ability roster, loadout, and talents',
        response: { 200: characterBuildResponseSchema },
      },
    },
    async (request) => buildService.getBuild(request.currentUser!.id),
  );

  typed.put(
    '/builds/me/loadout',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['builds'],
        summary: 'Set the equipped ability loadout (bounded, unlocked only)',
        body: setLoadoutRequestSchema,
        response: { 200: characterBuildResponseSchema },
      },
    },
    async (request) => buildService.setLoadout(request.currentUser!.id, request.body),
  );

  typed.put(
    '/builds/me/talents',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['builds'],
        summary: 'Choose (or clear) the talent for an unlocked tier',
        body: chooseTalentRequestSchema,
        response: { 200: characterBuildResponseSchema },
      },
    },
    async (request) => buildService.chooseTalent(request.currentUser!.id, request.body),
  );

  typed.post(
    '/builds/me/respec',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['builds'],
        summary: 'Respec at a trainer: reset loadout and talents for a Gold fee',
        body: respecRequestSchema,
        response: { 200: characterBuildResponseSchema },
      },
    },
    async (request) => buildService.respec(request.currentUser!.id, request.body.idempotencyKey),
  );
}
