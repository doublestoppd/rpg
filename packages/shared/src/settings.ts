import { z } from 'zod';

export const themeSchema = z.enum(['SYSTEM', 'LIGHT', 'DARK']);
export type Theme = z.infer<typeof themeSchema>;

export const accountSettingsSchema = z.object({
  theme: themeSchema,
});
export type AccountSettings = z.infer<typeof accountSettingsSchema>;

export const updateAccountSettingsSchema = z
  .object({
    theme: themeSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one setting to update',
  });
export type UpdateAccountSettings = z.infer<typeof updateAccountSettingsSchema>;
