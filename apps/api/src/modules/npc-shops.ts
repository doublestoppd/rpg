import { createNpcShopService } from '../domain/npc-shop/npc-shop-service.js';
import { npcShopRoutes } from '../routes/npc-shops.js';
import { type GameModule, requireService } from './types.js';

/** NPC shops with lazy weighted restocks and regional pricing. */
export const npcShopsModule: GameModule = {
  name: 'npc-shops',
  async register(ctx) {
    const npcShopService = createNpcShopService(
      ctx.prisma,
      requireService(ctx.services, 'characterService'),
      requireService(ctx.services, 'locationService'),
      requireService(ctx.services, 'currencyService'),
      requireService(ctx.services, 'inventoryService'),
    );
    ctx.services.npcShopService = npcShopService;
    await ctx.app.register(npcShopRoutes, { prefix: '/api/v1', npcShopService });
  },
};
