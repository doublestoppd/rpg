import { createCraftingService } from '../domain/crafting/crafting-service.js';
import { craftingRoutes } from '../routes/crafting.js';
import { type GameModule, requireService } from './types.js';

/** Deterministic timed blacksmithing; owns the crafting finalizer. */
export const craftingModule: GameModule = {
  name: 'crafting',
  async register(ctx) {
    const craftingService = createCraftingService(
      ctx.prisma,
      requireService(ctx.services, 'characterService'),
      requireService(ctx.services, 'locationService'),
      requireService(ctx.services, 'currencyService'),
      requireService(ctx.services, 'inventoryService'),
      requireService(ctx.services, 'questService').events,
    );
    ctx.services.craftingService = craftingService;
    ctx.timedStateFinalizers.push(craftingService.finalizer);
    await ctx.app.register(craftingRoutes, { prefix: '/api/v1', craftingService });
  },
};
