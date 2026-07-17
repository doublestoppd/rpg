import { createLocationService } from '../domain/location/location-service.js';
import { locationRoutes } from '../routes/locations.js';
import { type GameModule, requireService } from './types.js';

/**
 * The world graph and current-location resolution. Its travel guard runs
 * every registered timed-state finalizer before location-dependent actions.
 */
export const worldModule: GameModule = {
  name: 'world',
  async register(ctx) {
    const travelService = requireService(ctx.services, 'travelService');
    const locationService = createLocationService(
      ctx.prisma,
      requireService(ctx.services, 'characterService'),
      {
        async ensureAtLocation(characterId) {
          await ctx.timedStateRunner.finalizeAll(characterId);
          await travelService.assertNotTraveling(characterId);
        },
      },
    );
    ctx.services.locationService = locationService;
    await ctx.app.register(locationRoutes, { prefix: '/api/v1', locationService });
  },
};
