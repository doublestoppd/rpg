import { createLiveHub } from '../domain/notification/live-hub.js';
import { createNotificationService } from '../domain/notification/notification-service.js';
import { createSocketMaintenance } from '../domain/notification/socket-maintenance.js';
import { notificationRoutes } from '../routes/notifications.js';
import { type GameModule, requireService } from './types.js';

/** Heartbeat + session revalidation cadence for live sockets. */
const SOCKET_SWEEP_MS = 15_000;

/**
 * Persistent notifications + the shared live socket. Registers before every
 * module that emits notifications (travel, marketplace, gathering, crafting,
 * quests) and before chat, which fans out over the same socket via the
 * registered liveHub.
 */
export const notificationsModule: GameModule = {
  name: 'notifications',
  async register(ctx) {
    const characterService = requireService(ctx.services, 'characterService');
    const liveHub = createLiveHub();
    const notificationService = createNotificationService(ctx.prisma, characterService, liveHub);
    ctx.services.liveHub = liveHub;
    ctx.services.notificationService = notificationService;

    // Periodic socket maintenance: ping/terminate unresponsive connections
    // and close sockets whose session has been revoked or has expired.
    const maintenance = createSocketMaintenance(ctx.prisma, liveHub);
    const sweepTimer = setInterval(() => {
      void maintenance.sweep().catch(() => undefined);
    }, SOCKET_SWEEP_MS);
    sweepTimer.unref();
    ctx.app.addHook('onClose', async () => {
      clearInterval(sweepTimer);
    });

    await ctx.app.register(notificationRoutes, {
      prefix: '/api/v1',
      notificationService,
      characterService,
      liveHub,
      allowedOrigins: new Set(ctx.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())),
    });
  },
};
