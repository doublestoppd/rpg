import { createInnService } from '../domain/inn/inn-service.js';
import { currencyRoutes } from '../routes/currency.js';
import { type GameModule, requireService } from './types.js';

/** Gold balance/ledger views and the inn rest sink. */
export const currencyModule: GameModule = {
  name: 'currency',
  async register(ctx) {
    const innService = createInnService(
      ctx.prisma,
      requireService(ctx.services, 'characterService'),
      requireService(ctx.services, 'locationService'),
      requireService(ctx.services, 'currencyService'),
      requireService(ctx.services, 'inventoryService'),
    );
    ctx.services.innService = innService;
    await ctx.app.register(currencyRoutes, {
      prefix: '/api/v1',
      characterService: requireService(ctx.services, 'characterService'),
      currencyService: requireService(ctx.services, 'currencyService'),
      innService,
    });
  },
};
