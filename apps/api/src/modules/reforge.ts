import { createReforgeService } from '../domain/reforge/reforge-service.js';
import { reforgeRoutes } from '../routes/reforge.js';
import { type GameModule, requireService } from './types.js';

/** The Reforge Anvil: reroll equipment affixes for Gold (Improvement Phase 4). */
export const reforgeModule: GameModule = {
  name: 'reforge',
  async register(ctx) {
    const reforgeService = createReforgeService(
      ctx.prisma,
      requireService(ctx.services, 'currencyService'),
    );
    ctx.services.reforgeService = reforgeService;
    await ctx.app.register(reforgeRoutes, { prefix: '/api/v1', reforgeService });
  },
};
