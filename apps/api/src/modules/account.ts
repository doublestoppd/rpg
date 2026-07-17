import { createSettingsService } from '../domain/account/settings-service.js';
import { accountRoutes } from '../routes/account.js';
import type { GameModule } from './types.js';

/** Account preferences (theme, future notification settings). */
export const accountModule: GameModule = {
  name: 'account',
  async register(ctx) {
    const settingsService = createSettingsService(ctx.prisma);
    ctx.services.settingsService = settingsService;
    await ctx.app.register(accountRoutes, { prefix: '/api/v1', settingsService });
  },
};
