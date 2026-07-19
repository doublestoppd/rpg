import {
  adminCharacterListResponseSchema,
  adminCharacterOverviewResponseSchema,
  adminCharacterSearchQuerySchema,
  adminChatReportsQuerySchema,
  adminChatReportsResponseSchema,
  adminCreateRestrictionRequestSchema,
  adminCurrencyTransactionsResponseSchema,
  adminDateWindowQuerySchema,
  adminEconomyMetricsResponseSchema,
  adminGoldAdjustmentRequestSchema,
  adminGoldAdjustmentResponseSchema,
  adminInventoryResponseSchema,
  adminItemActionResponseSchema,
  adminItemDefinitionPatchSchema,
  adminItemDefinitionResponseSchema,
  adminItemGrantRequestSchema,
  adminItemRemovalRequestSchema,
  adminItemTransfersResponseSchema,
  adminMarketplaceActivityResponseSchema,
  adminMetricsQuerySchema,
  adminModerationResponseSchema,
  adminNpcShopConfigPatchSchema,
  adminNpcShopResponseSchema,
  adminProgressResponseSchema,
  adminReauthRequestSchema,
  adminReauthResponseSchema,
  adminRedactMessageRequestSchema,
  adminResolveReportRequestSchema,
  adminRestockRequestSchema,
  adminRestockResponseSchema,
  adminRestrictionResponseSchema,
  adminRevokeRestrictionRequestSchema,
  adminSessionResponseSchema,
} from '@rpg/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AdminActor } from '../domain/admin/admin-audit.js';
import {
  type AdminAuthService,
  adminOnly,
  isReauthValid,
  reauthRequired,
} from '../domain/admin/admin-auth.js';
import type { AdminEconomyService } from '../domain/admin/admin-economy.js';
import type { AdminInvestigationService } from '../domain/admin/admin-investigation.js';
import type { AdminModerationService } from '../domain/admin/admin-moderation.js';

interface AdminRouteOptions {
  adminAuthService: AdminAuthService;
  investigationService: AdminInvestigationService;
  economyService: AdminEconomyService;
  moderationService: AdminModerationService;
  reauthWindowMs: number;
  reauthRateLimit: { max: number; timeWindowMs: number };
}

export async function adminRoutes(app: FastifyInstance, opts: AdminRouteOptions): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const {
    adminAuthService,
    investigationService,
    economyService,
    moderationService,
    reauthWindowMs,
  } = opts;

  /** ADMIN role required. Authorization is always enforced by the API. */
  const requireAdmin = async (request: FastifyRequest): Promise<void> => {
    if (!request.currentUser || request.currentUser.role !== 'ADMIN') throw adminOnly();
  };

  /** ADMIN + recent password re-authentication within the window. */
  const requireReauth = async (request: FastifyRequest): Promise<void> => {
    if (!request.currentUser || request.currentUser.role !== 'ADMIN') throw adminOnly();
    if (!request.currentSession || !isReauthValid(request.currentSession, reauthWindowMs)) {
      throw reauthRequired();
    }
  };

  const actorOf = (request: FastifyRequest): AdminActor => ({
    userId: request.currentUser!.id,
    sessionId: request.currentSession!.id,
    requestId: request.id,
  });

  // --- session / reauth ----------------------------------------------------

  typed.get(
    '/admin/session',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Admin role and current recent-auth validity',
        response: { 200: adminSessionResponseSchema },
      },
    },
    async (request) =>
      adminAuthService.getSession(request.currentUser!.id, request.currentSession!),
  );

  typed.post(
    '/admin/reauth',
    {
      preHandler: [app.requireAuth, requireAdmin],
      config: {
        rateLimit: { max: opts.reauthRateLimit.max, timeWindow: opts.reauthRateLimit.timeWindowMs },
      },
      schema: {
        tags: ['admin'],
        summary: 'Verify the current password and stamp recent-auth on this session',
        body: adminReauthRequestSchema,
        response: { 200: adminReauthResponseSchema },
      },
    },
    async (request) =>
      adminAuthService.reauth(
        request.currentUser!.id,
        request.currentSession!.id,
        request.body.password,
      ),
  );

  // --- investigation reads (high-sensitivity: reauth) ----------------------

  typed.get(
    '/admin/characters',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Bounded character search (cursor paginated)',
        querystring: adminCharacterSearchQuerySchema,
        response: { 200: adminCharacterListResponseSchema },
      },
    },
    async (request) => investigationService.searchCharacters(request.query),
  );

  const charParams = z.object({ id: z.uuid() });

  typed.get(
    '/admin/characters/:id/overview',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Character overview (high-sensitivity)',
        params: charParams,
        response: { 200: adminCharacterOverviewResponseSchema },
      },
    },
    async (request) => investigationService.overview(request.params.id),
  );

  typed.get(
    '/admin/characters/:id/inventory',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Character inventory (high-sensitivity)',
        params: charParams,
        response: { 200: adminInventoryResponseSchema },
      },
    },
    async (request) => investigationService.inventory(request.params.id),
  );

  typed.get(
    '/admin/characters/:id/currency-transactions',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Character ledger (paginated, date-bounded, high-sensitivity)',
        params: charParams,
        querystring: adminDateWindowQuerySchema,
        response: { 200: adminCurrencyTransactionsResponseSchema },
      },
    },
    async (request) => investigationService.currencyTransactions(request.params.id, request.query),
  );

  typed.get(
    '/admin/characters/:id/item-transfers',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Character item transfers (paginated, date-bounded)',
        params: charParams,
        querystring: adminDateWindowQuerySchema,
        response: { 200: adminItemTransfersResponseSchema },
      },
    },
    async (request) => investigationService.itemTransfers(request.params.id, request.query),
  );

  typed.get(
    '/admin/characters/:id/marketplace-activity',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Character marketplace activity (paginated, date-bounded)',
        params: charParams,
        querystring: adminDateWindowQuerySchema,
        response: { 200: adminMarketplaceActivityResponseSchema },
      },
    },
    async (request) => investigationService.marketplaceActivity(request.params.id, request.query),
  );

  typed.get(
    '/admin/characters/:id/progress',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Character quests, collections, and skills',
        params: charParams,
        response: { 200: adminProgressResponseSchema },
      },
    },
    async (request) => investigationService.progress(request.params.id),
  );

  // --- economy operations (reauth) -----------------------------------------

  typed.post(
    '/admin/characters/:id/gold-adjustments',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Signed Gold adjustment through the ledger (audited, idempotent)',
        params: charParams,
        body: adminGoldAdjustmentRequestSchema,
        response: { 200: adminGoldAdjustmentResponseSchema },
      },
    },
    async (request) => economyService.adjustGold(actorOf(request), request.params.id, request.body),
  );

  typed.post(
    '/admin/characters/:id/item-grants',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Grant items (capacity-aware, audited, idempotent)',
        params: charParams,
        body: adminItemGrantRequestSchema,
        response: { 200: adminItemActionResponseSchema },
      },
    },
    async (request) => economyService.grantItem(actorOf(request), request.params.id, request.body),
  );

  typed.post(
    '/admin/characters/:id/item-removals',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Remove a free item (rejects every locked state; no force path)',
        params: charParams,
        body: adminItemRemovalRequestSchema,
        response: { 200: adminItemActionResponseSchema },
      },
    },
    async (request) => economyService.removeItem(actorOf(request), request.params.id, request.body),
  );

  typed.patch(
    '/admin/item-definitions/:slug',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Edit safe item-definition fields with optimistic concurrency',
        params: z.object({ slug: z.string().min(1) }),
        body: adminItemDefinitionPatchSchema,
        response: { 200: adminItemDefinitionResponseSchema },
      },
    },
    async (request) =>
      economyService.patchItemDefinition(actorOf(request), request.params.slug, request.body),
  );

  typed.patch(
    '/admin/npc-shops/:id/config',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Edit safe shop configuration with optimistic concurrency',
        params: charParams,
        body: adminNpcShopConfigPatchSchema,
        response: { 200: adminNpcShopResponseSchema },
      },
    },
    async (request) =>
      economyService.patchShopConfig(actorOf(request), request.params.id, request.body),
  );

  typed.post(
    '/admin/npc-shops/:id/restock',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Schedule an immediate restock through the normal locked service',
        params: charParams,
        body: adminRestockRequestSchema,
        response: { 200: adminRestockResponseSchema },
      },
    },
    async (request) =>
      economyService.requestRestock(actorOf(request), request.params.id, request.body),
  );

  typed.get(
    '/admin/metrics/economy',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Database-derived economy metrics for a bounded UTC window',
        querystring: adminMetricsQuerySchema,
        response: { 200: adminEconomyMetricsResponseSchema },
      },
    },
    async (request) => economyService.economyMetrics(request.query),
  );

  // --- chat moderation -----------------------------------------------------

  typed.get(
    '/admin/chat/reports',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Reported messages with evidence (reporter identity never shown)',
        querystring: adminChatReportsQuerySchema,
        response: { 200: adminChatReportsResponseSchema },
      },
    },
    async (request) => moderationService.listReports(request.query),
  );

  typed.post(
    '/admin/chat/reports/:id/resolve',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Resolve or dismiss a report (evidence preserved)',
        params: charParams,
        body: adminResolveReportRequestSchema,
        response: { 200: adminModerationResponseSchema },
      },
    },
    async (request) =>
      moderationService.resolveReport(actorOf(request), request.params.id, request.body),
  );

  typed.post(
    '/admin/chat/messages/:id/redact',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Redact a message to a tombstone (never hard-delete)',
        params: charParams,
        body: adminRedactMessageRequestSchema,
        response: { 200: adminModerationResponseSchema },
      },
    },
    async (request) =>
      moderationService.redactMessage(actorOf(request), request.params.id, request.body),
  );

  typed.post(
    '/admin/chat/restrictions',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Apply a chat-send restriction (enforced immediately)',
        body: adminCreateRestrictionRequestSchema,
        response: { 200: adminRestrictionResponseSchema },
      },
    },
    async (request) => moderationService.createRestriction(actorOf(request), request.body),
  );

  typed.post(
    '/admin/chat/restrictions/:id/revoke',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Revoke a chat restriction (history preserved)',
        params: charParams,
        body: adminRevokeRestrictionRequestSchema,
        response: { 200: adminModerationResponseSchema },
      },
    },
    async (request) =>
      moderationService.revokeRestriction(actorOf(request), request.params.id, request.body),
  );
}
