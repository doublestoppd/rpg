import { createQuestService } from '../domain/quest/quest-service.js';
import { questRoutes } from '../routes/quests.js';
import { type GameModule, requireService } from './types.js';

/**
 * Quests and the typed domain-event sink. Registers before every module
 * that emits progress events (travel, gathering, crafting, combat).
 */
export const questsModule: GameModule = {
  name: 'quests',
  async register(ctx) {
    const questService = createQuestService(
      ctx.prisma,
      requireService(ctx.services, 'characterService'),
      requireService(ctx.services, 'currencyService'),
      requireService(ctx.services, 'inventoryService'),
      requireService(ctx.services, 'notificationService'),
    );
    ctx.services.questService = questService;
    await ctx.app.register(questRoutes, { prefix: '/api/v1', questService });
  },
};
