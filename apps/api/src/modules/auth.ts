import { createAuthService } from '../domain/auth/auth-service.js';
import { authPlugin } from '../plugins/auth-plugin.js';
import { authRoutes } from '../routes/auth.js';
import type { GameModule } from './types.js';

/** Accounts and sessions; installs the auth plugin every later module uses. */
export const authModule: GameModule = {
  name: 'auth',
  async register(ctx) {
    const authService = createAuthService(ctx.prisma);
    ctx.services.authService = authService;
    await ctx.app.register(authPlugin, { env: ctx.env, authService });
    await ctx.app.register(authRoutes, {
      prefix: '/api/v1',
      env: ctx.env,
      authService,
      loginRateLimit: ctx.authRateLimit,
    });
  },
};
