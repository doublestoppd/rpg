import { createTravelService } from '../domain/travel/travel-service.js';
import { travelRoutes } from '../routes/travel.js';
import { type GameModule, requireService } from './types.js';

/** Timed travel across the world graph; owns the travel finalizer. */
export const travelModule: GameModule = {
  name: 'travel',
  async register(ctx) {
    const travelService = createTravelService(
      ctx.prisma,
      requireService(ctx.services, 'characterService'),
      requireService(ctx.services, 'questService').events,
      requireService(ctx.services, 'notificationService'),
    );
    ctx.services.travelService = travelService;
    ctx.timedStateFinalizers.push(travelService.finalizer);
    await ctx.app.register(travelRoutes, { prefix: '/api/v1', travelService });
  },
};
