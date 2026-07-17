import { createMuseumService } from '../domain/museum/museum-service.js';
import { museumRoutes } from '../routes/museum.js';
import { type GameModule, requireService } from './types.js';

/** Museum collections and irreversible artifact donations. */
export const museumModule: GameModule = {
  name: 'museum',
  async register(ctx) {
    const museumService = createMuseumService(
      ctx.prisma,
      requireService(ctx.services, 'characterService'),
      requireService(ctx.services, 'locationService'),
      requireService(ctx.services, 'inventoryService'),
      requireService(ctx.services, 'questService').events,
    );
    ctx.services.museumService = museumService;
    await ctx.app.register(museumRoutes, { prefix: '/api/v1', museumService });
  },
};
