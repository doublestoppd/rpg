import type { PrismaClient, Session, User } from '@prisma/client';
import type { PublicUser, SessionResponse } from '@rpg/shared';

import { conflict, invalidCredentials, unauthorized } from '../../lib/http-errors.js';
import { hashPassword, verifyPassword } from '../../lib/passwords.js';
import { generateCsrfToken, generateSessionToken, hashSessionToken } from '../../lib/tokens.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface IssuedSession {
  rawToken: string;
  session: Session;
  user: User;
}

export interface AuthService {
  register(input: { email: string; password: string; displayName: string }): Promise<IssuedSession>;
  login(input: { email: string; password: string }): Promise<IssuedSession>;
  logout(sessionId: string): Promise<void>;
  /** Resolves an active (unrevoked, unexpired) session from the raw cookie token. */
  resolveSession(rawToken: string): Promise<{ session: Session; user: User } | null>;
  changePassword(input: {
    user: User;
    currentSession: Session;
    currentPassword: string;
    newPassword: string;
  }): Promise<IssuedSession>;
  revokeOtherSessions(userId: string, currentSessionId: string): Promise<number>;
  buildSessionResponse(user: User, session: Session): Promise<SessionResponse>;
}

export function createAuthService(prisma: PrismaClient): AuthService {
  async function issueSession(
    tx: Pick<PrismaClient, 'session'>,
    user: User,
  ): Promise<IssuedSession> {
    const rawToken = generateSessionToken();
    const session = await tx.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(rawToken),
        csrfToken: generateCsrfToken(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return { rawToken, session, user };
  }

  return {
    async register({ email, password, displayName }) {
      const existingEmail = await prisma.user.findUnique({ where: { email } });
      if (existingEmail) throw conflict('EMAIL_TAKEN', 'That email is already registered.');
      const existingName = await prisma.user.findUnique({ where: { displayName } });
      if (existingName) throw conflict('DISPLAY_NAME_TAKEN', 'That display name is taken.');

      const passwordHash = await hashPassword(password);
      // Accounts are active immediately; email verification is out of scope.
      return prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            displayName,
            settings: { create: {} },
          },
        });
        return issueSession(tx, user);
      });
    },

    async login({ email, password }) {
      const user = await prisma.user.findUnique({ where: { email } });
      // Generic response either way: do not reveal whether the email exists.
      if (!user) throw invalidCredentials();
      const valid = await verifyPassword(user.passwordHash, password);
      if (!valid) throw invalidCredentials();
      // A login always issues a fresh token; no pre-login token is ever reused.
      return issueSession(prisma, user);
    },

    async logout(sessionId) {
      await prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },

    async resolveSession(rawToken) {
      const now = new Date();
      const session = await prisma.session.findUnique({
        where: { tokenHash: hashSessionToken(rawToken) },
        include: { user: true },
      });
      if (!session || session.revokedAt !== null || session.expiresAt <= now) return null;
      // Touch lastUsedAt at most once per minute to avoid write amplification.
      if (now.getTime() - session.lastUsedAt.getTime() > 60_000) {
        await prisma.session.update({
          where: { id: session.id },
          data: { lastUsedAt: now },
        });
      }
      const { user, ...bare } = session;
      return { session: bare as Session, user };
    },

    async changePassword({ user, currentSession, currentPassword, newPassword }) {
      const valid = await verifyPassword(user.passwordHash, currentPassword);
      if (!valid) throw unauthorized('Current password is incorrect.');
      const passwordHash = await hashPassword(newPassword);
      // Rotate the session token: revoke the current session and issue a new
      // one atomically with the password update.
      return prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: { passwordHash },
        });
        await tx.session.update({
          where: { id: currentSession.id },
          data: { revokedAt: new Date() },
        });
        return issueSession(tx, updatedUser);
      });
    },

    async revokeOtherSessions(userId, currentSessionId) {
      const result = await prisma.session.updateMany({
        where: { userId, id: { not: currentSessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return result.count;
    },

    async buildSessionResponse(user, session) {
      const activeSessionCount = await prisma.session.count({
        where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      return {
        user: toPublicUser(user),
        csrfToken: session.csrfToken,
        sessionExpiresAt: session.expiresAt.toISOString(),
        activeSessionCount,
      };
    },
  };
}

export function toPublicUser(user: User): PublicUser {
  // Explicit mapping: internal columns (passwordHash, …) never leak.
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}
