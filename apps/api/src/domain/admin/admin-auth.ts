import type { PrismaClient, Session } from '@prisma/client';
import type { AdminReauthResponse, AdminSessionResponse } from '@rpg/shared';

import { DomainError, forbidden } from '../../lib/http-errors.js';
import { verifyPassword } from '../../lib/passwords.js';

export const adminOnly = () => forbidden('ADMIN_REQUIRED', 'Administrator access is required.');

export const reauthRequired = () =>
  forbidden('REAUTH_REQUIRED', 'Recent password re-authentication is required.');

/** True when the session's recent-auth marker is within the window at `now`. */
export function isReauthValid(
  session: Pick<Session, 'adminReauthenticatedAt'>,
  windowMs: number,
  now: Date = new Date(),
): boolean {
  const at = session.adminReauthenticatedAt;
  return at !== null && now.getTime() - at.getTime() <= windowMs;
}

export interface AdminAuthService {
  /** Role + current recent-auth validity for the acting session. */
  getSession(userId: string, session: Session): Promise<AdminSessionResponse>;
  /**
   * Verifies the current password and stamps recent-auth on THIS session only
   * (no second bearer token). Rate limiting is applied at the route.
   */
  reauth(userId: string, sessionId: string, password: string): Promise<AdminReauthResponse>;
}

export function createAdminAuthService(
  prisma: PrismaClient,
  reauthWindowMs: number,
): AdminAuthService {
  return {
    async getSession(userId, session) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const valid = isReauthValid(session, reauthWindowMs);
      return {
        role: user.role,
        reauthValidUntil:
          valid && session.adminReauthenticatedAt
            ? new Date(session.adminReauthenticatedAt.getTime() + reauthWindowMs).toISOString()
            : null,
      };
    },

    async reauth(userId, sessionId, password) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.role !== 'ADMIN') throw adminOnly();
      const valid = await verifyPassword(user.passwordHash, password);
      // Generic failure — never reveal whether the password or role was wrong.
      if (!valid) throw new DomainError(401, 'REAUTH_FAILED', 'Re-authentication failed.');
      const now = new Date();
      await prisma.session.update({
        where: { id: sessionId },
        data: { adminReauthenticatedAt: now },
      });
      return { reauthValidUntil: new Date(now.getTime() + reauthWindowMs).toISOString() };
    },
  };
}
