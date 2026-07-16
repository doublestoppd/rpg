import type { PrismaClient } from '@prisma/client';
import type { AccountSettings, UpdateAccountSettings } from '@rpg/shared';

export interface SettingsService {
  getSettings(userId: string): Promise<AccountSettings>;
  updateSettings(userId: string, update: UpdateAccountSettings): Promise<AccountSettings>;
}

export function createSettingsService(prisma: PrismaClient): SettingsService {
  return {
    async getSettings(userId) {
      const settings = await prisma.userSettings.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      return { theme: settings.theme };
    },

    async updateSettings(userId, update) {
      const settings = await prisma.userSettings.upsert({
        where: { userId },
        create: { userId, ...(update.theme !== undefined ? { theme: update.theme } : {}) },
        update: { ...(update.theme !== undefined ? { theme: update.theme } : {}) },
      });
      return { theme: settings.theme };
    },
  };
}
