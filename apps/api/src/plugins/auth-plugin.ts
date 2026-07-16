import type { Session, User } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { AuthService } from '../domain/auth/auth-service.js';
import type { Env } from '../config/env.js';

export const SESSION_COOKIE = 'rpg_session';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: User | null;
    currentSession: Session | null;
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

interface AuthPluginOptions {
  env: Env;
  authService: AuthService;
}

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Session resolution plus CSRF defense-in-depth:
 * every state-changing /api request must carry an allowed Origin header, and
 * authenticated state-changing requests must also carry the session's CSRF
 * token in X-CSRF-Token.
 */
export const authPlugin = fp<AuthPluginOptions>(async (app: FastifyInstance, opts) => {
  const allowedOrigins = new Set(opts.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()));

  app.decorateRequest('currentUser', null);
  app.decorateRequest('currentSession', null);

  app.addHook('onRequest', async (request, reply) => {
    // Resolve the session from the HttpOnly cookie, if present.
    const rawToken = request.cookies[SESSION_COOKIE];
    if (rawToken) {
      const resolved = await opts.authService.resolveSession(rawToken);
      if (resolved) {
        request.currentUser = resolved.user;
        request.currentSession = resolved.session;
      }
    }

    if (!STATE_CHANGING_METHODS.has(request.method)) return;
    if (!request.url.startsWith('/api/')) return;

    // Origin validation applies to every state-changing request, including
    // unauthenticated ones (register, login).
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !allowedOrigins.has(origin)) {
      return reply.status(403).send({
        error: {
          code: 'ORIGIN_FORBIDDEN',
          message: 'Request origin is missing or not allowed.',
          requestId: request.id,
        },
      });
    }

    // CSRF token validation applies to authenticated state-changing requests.
    if (request.currentSession) {
      const headerToken = request.headers['x-csrf-token'];
      if (typeof headerToken !== 'string' || headerToken !== request.currentSession.csrfToken) {
        return reply.status(403).send({
          error: {
            code: 'CSRF_FORBIDDEN',
            message: 'Missing or invalid CSRF token.',
            requestId: request.id,
          },
        });
      }
    }
  });

  app.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.currentUser || !request.currentSession) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required.',
          requestId: request.id,
        },
      });
    }
  });
});
