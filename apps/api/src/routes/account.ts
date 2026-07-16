import { accountSettingsSchema, updateAccountSettingsSchema } from '@rpg/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { SettingsService } from '../domain/account/settings-service.js';

interface AccountRouteOptions {
  settingsService: SettingsService;
}

export async function accountRoutes(
  app: FastifyInstance,
  opts: AccountRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/account/settings',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['account'],
        summary: 'Read account settings',
        response: { 200: accountSettingsSchema },
      },
    },
    async (request) => opts.settingsService.getSettings(request.currentUser!.id),
  );

  typed.patch(
    '/account/settings',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['account'],
        summary: 'Update account settings',
        body: updateAccountSettingsSchema,
        response: { 200: accountSettingsSchema },
      },
    },
    async (request) => opts.settingsService.updateSettings(request.currentUser!.id, request.body),
  );
}
