import { createLiveHub } from '../domain/notification/live-hub.js';
import { createNotificationService } from '../domain/notification/notification-service.js';
import { notificationRoutes } from '../routes/notifications.js';
import { type GameModule, requireService } from './types.js';

/**
 * Persistent notifications + the optional live-sync socket. Registers
 * before every module that emits notifications (travel, marketplace,
 * gathering, crafting, quests).
 */
export const notificationsModule: GameModule = {
  name: 'notifications',
  async register(ctx) {
    const characterService = requireService(ctx.services, 'characterService');
    const liveHub = createLiveHub();
    const notificationService = createNotificationService(ctx.prisma, characterService, liveHub);
    ctx.services.notificationService = notificationService;
    await ctx.app.register(notificationRoutes, {
      prefix: '/api/v1',
      notificationService,
      characterService,
      liveHub,
    });
  },
};
