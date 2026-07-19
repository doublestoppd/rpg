import { createBuildService } from '../domain/character/build-service.js';
import { buildRoutes } from '../routes/builds.js';
import { type GameModule, requireService } from './types.js';

/**
 * Character builds (Phase 23): ability loadouts, talents, and trainer respec.
 * Registers after characters and currency (its dependencies) and before combat,
 * which reads the build service to snapshot the loadout at battle start.
 */
export const buildsModule: GameModule = {
  name: 'builds',
  async register(ctx) {
    const buildService = createBuildService(
      ctx.prisma,
      requireService(ctx.services, 'characterService'),
      requireService(ctx.services, 'currencyService'),
    );
    ctx.services.buildService = buildService;
    await ctx.app.register(buildRoutes, { prefix: '/api/v1', buildService });
  },
};
