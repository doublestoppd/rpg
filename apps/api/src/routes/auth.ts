import {
  changePasswordRequestSchema,
  loginRequestSchema,
  okResponseSchema,
  registerRequestSchema,
  revokeOtherSessionsResponseSchema,
  sessionResponseSchema,
} from '@rpg/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { Env } from '../config/env.js';
import type { AuthService, IssuedSession } from '../domain/auth/auth-service.js';
import { SESSION_COOKIE } from '../plugins/auth-plugin.js';

interface AuthRouteOptions {
  env: Env;
  authService: AuthService;
  loginRateLimit: { max: number; timeWindowMs: number };
}

export async function authRoutes(app: FastifyInstance, opts: AuthRouteOptions): Promise<void> {
  const { authService, env } = opts;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  function setSessionCookie(reply: FastifyReply, issued: IssuedSession): void {
    reply.setCookie(SESSION_COOKIE, issued.rawToken, {
      path: '/',
      httpOnly: true,
      // Secure requires HTTPS; development and tests run over plain HTTP.
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: issued.session.expiresAt,
    });
  }

  function clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  typed.post(
    '/auth/register',
    {
      config: {
        rateLimit: { max: opts.loginRateLimit.max, timeWindow: opts.loginRateLimit.timeWindowMs },
      },
      schema: {
        tags: ['auth'],
        summary: 'Register a new account (active immediately)',
        body: registerRequestSchema,
        response: { 201: sessionResponseSchema },
      },
    },
    async (request, reply) => {
      const issued = await authService.register(request.body);
      setSessionCookie(reply, issued);
      const body = await authService.buildSessionResponse(issued.user, issued.session);
      return reply.status(201).send(body);
    },
  );

  typed.post(
    '/auth/login',
    {
      config: {
        rateLimit: { max: opts.loginRateLimit.max, timeWindow: opts.loginRateLimit.timeWindowMs },
      },
      schema: {
        tags: ['auth'],
        summary: 'Log in with email and password',
        body: loginRequestSchema,
        response: { 200: sessionResponseSchema },
      },
    },
    async (request, reply) => {
      const issued = await authService.login(request.body);
      setSessionCookie(reply, issued);
      const body = await authService.buildSessionResponse(issued.user, issued.session);
      return reply.status(200).send(body);
    },
  );

  typed.post(
    '/auth/logout',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['auth'],
        summary: 'Log out and invalidate the current session',
        response: { 200: okResponseSchema },
      },
    },
    async (request, reply) => {
      await authService.logout(request.currentSession!.id);
      clearSessionCookie(reply);
      return reply.status(200).send({ ok: true as const });
    },
  );

  typed.get(
    '/auth/session',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['auth'],
        summary: 'Inspect the current session',
        response: { 200: sessionResponseSchema },
      },
    },
    async (request) => {
      return authService.buildSessionResponse(request.currentUser!, request.currentSession!);
    },
  );

  typed.post(
    '/auth/change-password',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['auth'],
        summary: 'Change password and rotate the session token',
        body: changePasswordRequestSchema,
        response: { 200: sessionResponseSchema },
      },
    },
    async (request, reply) => {
      const issued = await authService.changePassword({
        user: request.currentUser!,
        currentSession: request.currentSession!,
        currentPassword: request.body.currentPassword,
        newPassword: request.body.newPassword,
      });
      setSessionCookie(reply, issued);
      const body = await authService.buildSessionResponse(issued.user, issued.session);
      return reply.status(200).send(body);
    },
  );

  typed.post(
    '/auth/revoke-other-sessions',
    {
      preHandler: app.requireAuth,
      schema: {
        tags: ['auth'],
        summary: 'Revoke every session except the current one',
        response: { 200: revokeOtherSessionsResponseSchema },
      },
    },
    async (request) => {
      const revokedCount = await authService.revokeOtherSessions(
        request.currentUser!.id,
        request.currentSession!.id,
      );
      return { revokedCount };
    },
  );
}
