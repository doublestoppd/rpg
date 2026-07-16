import { z } from 'zod';

export const userRoleSchema = z.enum(['USER', 'ADMIN']);
export type UserRole = z.infer<typeof userRoleSchema>;

/** Emails are normalized (trimmed, lowercased) before validation and storage. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }))
  .pipe(z.string().max(254));

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

export const displayNameSchema = z
  .string()
  .trim()
  .min(3, 'Display name must be at least 3 characters')
  .max(24, 'Display name must be at most 24 characters')
  .regex(
    /^[\p{L}\p{N}][\p{L}\p{N} _'-]*$/u,
    'Display name may contain letters, numbers, spaces, underscores, apostrophes, and hyphens',
  );

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const publicUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  role: userRoleSchema,
  createdAt: z.iso.datetime(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const sessionResponseSchema = z.object({
  user: publicUserSchema,
  /** Required as X-CSRF-Token on every state-changing request. */
  csrfToken: z.string(),
  sessionExpiresAt: z.iso.datetime(),
  activeSessionCount: z.number().int().min(1),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const revokeOtherSessionsResponseSchema = z.object({
  revokedCount: z.number().int().min(0),
});
export type RevokeOtherSessionsResponse = z.infer<typeof revokeOtherSessionsResponseSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof okResponseSchema>;
