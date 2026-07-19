import {
  bountyBoardResponseSchema,
  claimBountyRequestSchema,
  claimBountyResponseSchema,
  salvageRequestSchema,
  salvageResponseSchema,
} from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { BountyService } from '../domain/activities/bounty-service.js';
import type { SalvageService } from '../domain/activities/salvage-service.js';

interface ActivityRouteOptions {
  bountyService: BountyService;
  salvageService: SalvageService;
}

/**
 * Repeatable activities (Phase 24): the rotating bounty board and equipment
 * salvage. Rewards are exactly once per character and cycle; salvage is a net
 * item sink that preserves the destruction and transfer records.
 */
export async function activityRoutes(
  app: FastifyInstance,
  opts: ActivityRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { bountyService, salvageService } = opts;

  typed.get(
    '/bounties',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['activities'],
        summary: "The current cycle's bounty board and regional reputation",
        response: { 200: bountyBoardResponseSchema },
      },
    },
    async (request) => bountyService.getBoard(request.currentUser!.id),
  );

  typed.post(
    '/bounties/:slug/claims',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['activities'],
        summary: 'Claim a bounty (turn-in; once per character and cycle)',
        params: z.object({ slug: z.string().min(1).max(120) }),
        body: claimBountyRequestSchema,
        response: { 200: claimBountyResponseSchema },
      },
    },
    async (request) =>
      bountyService.claim(
        request.currentUser!.id,
        request.params.slug,
        request.body.idempotencyKey,
      ),
  );

  typed.post(
    '/inventory/salvage',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['activities'],
        summary: 'Salvage an equipment instance into crafting materials',
        body: salvageRequestSchema,
        response: { 200: salvageResponseSchema },
      },
    },
    async (request) => salvageService.salvage(request.currentUser!.id, request.body.itemInstanceId),
  );
}
