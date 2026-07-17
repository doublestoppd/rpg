import { createMarketplaceService } from '../domain/marketplace/marketplace-service.js';
import { marketplaceRoutes } from '../routes/marketplace.js';
import { type GameModule, requireService } from './types.js';

/** Player shops, listings, purchases, deliveries; owns two finalizers. */
export const marketplaceModule: GameModule = {
  name: 'marketplace',
  async register(ctx) {
    const marketplaceService = createMarketplaceService(
      ctx.prisma,
      requireService(ctx.services, 'characterService'),
      requireService(ctx.services, 'locationService'),
      requireService(ctx.services, 'currencyService'),
      requireService(ctx.services, 'inventoryService'),
      requireService(ctx.services, 'notificationService'),
    );
    ctx.services.marketplaceService = marketplaceService;
    ctx.timedStateFinalizers.push(
      marketplaceService.deliveryFinalizer,
      marketplaceService.listingExpiryFinalizer,
    );
    await ctx.app.register(marketplaceRoutes, { prefix: '/api/v1', marketplaceService });
  },
};
