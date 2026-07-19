import { createAdminAuthService } from '../domain/admin/admin-auth.js';
import { createAdminContentService } from '../domain/admin/admin-content.js';
import { createAdminEconomyService } from '../domain/admin/admin-economy.js';
import { createAdminInvestigationService } from '../domain/admin/admin-investigation.js';
import { createAdminModerationService } from '../domain/admin/admin-moderation.js';
import { adminRoutes } from '../routes/admin.js';
import { adminContentRoutes } from '../routes/admin-content.js';
import { type GameModule, requireService } from './types.js';

/**
 * Administration, moderation, and auditable economy operations (Phase 17).
 * Extends existing domain services (currency, inventory, npc-shops) rather
 * than duplicating mutation logic; every admin mutation is domain-service
 * backed and paired with an append-only same-transaction AdminAuditLog row.
 * Registers after every economy and chat module so its dependencies exist.
 */
export const adminModule: GameModule = {
  name: 'admin',
  async register(ctx) {
    const reauthWindowMs = ctx.env.ADMIN_REAUTH_WINDOW_MINUTES * 60 * 1000;

    const adminAuthService = createAdminAuthService(ctx.prisma, reauthWindowMs);
    const investigationService = createAdminInvestigationService(ctx.prisma);
    const economyService = createAdminEconomyService(
      ctx.prisma,
      requireService(ctx.services, 'currencyService'),
      requireService(ctx.services, 'inventoryService'),
      requireService(ctx.services, 'npcShopService'),
    );
    const moderationService = createAdminModerationService(ctx.prisma);
    const contentService = createAdminContentService(ctx.prisma);

    await ctx.app.register(adminRoutes, {
      prefix: '/api/v1',
      adminAuthService,
      investigationService,
      economyService,
      moderationService,
      reauthWindowMs,
      // Reauth is a password check: rate-limit it like login.
      reauthRateLimit: { max: ctx.env.ADMIN_REAUTH_RATE_LIMIT_MAX, timeWindowMs: 60_000 },
    });

    // Content Studio (Phase 20): versioned authoring, validation, and atomic
    // publication onto the live tables the engine already reads.
    await ctx.app.register(adminContentRoutes, {
      prefix: '/api/v1',
      contentService,
      reauthWindowMs,
    });
  },
};
