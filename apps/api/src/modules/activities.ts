import { createBountyService } from '../domain/activities/bounty-service.js';
import { createSalvageService } from '../domain/activities/salvage-service.js';
import { activityRoutes } from '../routes/activities.js';
import { type GameModule, requireService } from './types.js';

/**
 * Repeatable activities (Phase 24): the rotating bounty board, regional
 * reputation, and equipment salvage. Registers after its dependencies
 * (characters, currency, inventory).
 */
export const activitiesModule: GameModule = {
  name: 'activities',
  async register(ctx) {
    const characterService = requireService(ctx.services, 'characterService');
    const currencyService = requireService(ctx.services, 'currencyService');
    const inventoryService = requireService(ctx.services, 'inventoryService');

    const bountyService = createBountyService(
      ctx.prisma,
      characterService,
      currencyService,
      inventoryService,
    );
    const salvageService = createSalvageService(ctx.prisma, characterService, inventoryService);

    await ctx.app.register(activityRoutes, { prefix: '/api/v1', bountyService, salvageService });
  },
};
