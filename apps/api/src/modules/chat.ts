import { createChatLive } from '../domain/chat/chat-live.js';
import { createChatRateLimiter } from '../domain/chat/chat-rate-limit.js';
import { createChatService } from '../domain/chat/chat-service.js';
import { chatRoutes } from '../routes/chat.js';
import { type GameModule, requireService } from './types.js';

/**
 * Player chat: persistent global + location channels, safety controls, and
 * best-effort real-time invalidations over the shared notifications socket
 * with PostgreSQL LISTEN/NOTIFY cross-instance fan-out. Registers after
 * travel (lazy finalization drives channel membership) and notifications
 * (the shared liveHub).
 */
export const chatModule: GameModule = {
  name: 'chat',
  async register(ctx) {
    const characterService = requireService(ctx.services, 'characterService');
    const liveHub = requireService(ctx.services, 'liveHub');

    const chatLive = createChatLive(ctx.prisma, liveHub, ctx.env.DATABASE_URL);
    // A dead listener never blocks startup or correctness — it only costs
    // cross-instance latency until it reconnects; polling covers the rest.
    await chatLive.start();
    ctx.app.addHook('onClose', async () => {
      await chatLive.stop();
    });

    const chatService = createChatService(
      ctx.prisma,
      characterService,
      ctx.timedStateRunner,
      createChatRateLimiter({
        accountBurst: ctx.env.CHAT_RATE_LIMIT_BURST,
        accountPerMinute: ctx.env.CHAT_RATE_LIMIT_PER_MINUTE,
        ipBurst: ctx.env.CHAT_RATE_LIMIT_IP_BURST,
        ipPerMinute: ctx.env.CHAT_RATE_LIMIT_IP_PER_MINUTE,
      }),
      chatLive,
    );
    ctx.services.chatService = chatService;
    await ctx.app.register(chatRoutes, { prefix: '/api/v1', chatService });
  },
};
