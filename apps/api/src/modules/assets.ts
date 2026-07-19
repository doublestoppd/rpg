import { assetRoutes } from '../routes/assets.js';
import type { GameModule } from './types.js';

/**
 * The visual asset manifest endpoint (Phase 21). Stateless and dependency-free:
 * it serves compiled-in asset data, so it can register anywhere in the order.
 */
export const assetsModule: GameModule = {
  name: 'assets',
  async register(ctx) {
    await ctx.app.register(assetRoutes, { prefix: '/api/v1' });
  },
};
