import { createCombatService } from '../domain/combat/combat-service.js';
import { combatRoutes } from '../routes/combat.js';
import { type GameModule, requireService } from './types.js';

/** Persisted initiative-gauge combat. */
export const combatModule: GameModule = {
  name: 'combat',
  async register(ctx) {
    const combatService = createCombatService(
      ctx.prisma,
      requireService(ctx.services, 'characterService'),
      requireService(ctx.services, 'locationService'),
      requireService(ctx.services, 'currencyService'),
      requireService(ctx.services, 'inventoryService'),
      requireService(ctx.services, 'questService').events,
    );
    ctx.services.combatService = combatService;
    await ctx.app.register(combatRoutes, { prefix: '/api/v1', combatService });
  },
};
