import { createGatheringService } from '../domain/gathering/gathering-service.js';
import { gatheringRoutes } from '../routes/gathering.js';
import { type GameModule, requireService } from './types.js';

/** Timed mining with server-private outcomes; owns the gathering finalizer. */
export const gatheringModule: GameModule = {
  name: 'gathering',
  async register(ctx) {
    const gatheringService = createGatheringService(
      ctx.prisma,
      requireService(ctx.services, 'characterService'),
      requireService(ctx.services, 'locationService'),
      requireService(ctx.services, 'inventoryService'),
      requireService(ctx.services, 'questService').events,
    );
    ctx.services.gatheringService = gatheringService;
    ctx.timedStateFinalizers.push(gatheringService.finalizer);
    await ctx.app.register(gatheringRoutes, { prefix: '/api/v1', gatheringService });
  },
};
