import { randomUUID } from 'node:crypto';

import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import type { Env } from './config/env.js';
import { DomainError } from './lib/http-errors.js';
import { buildLoggerOptions } from './lib/logger.js';
import { metrics } from './lib/metrics.js';
import { registerMutationAudit } from './lib/observability.js';
import { createTimedStateRunner, type TimedStateFinalizer } from './lib/timed-state.js';
import { GAME_MODULES } from './modules/index.js';
import type { ModuleContext, ServiceRegistry } from './modules/types.js';
import { healthRoutes } from './routes/health.js';

export interface AppDependencies {
  env: Env;
  prisma: PrismaClient;
  /** Resolves when the database is reachable; rejects otherwise. */
  pingDatabase: () => Promise<void>;
  /** Login/register rate limit; overridable in tests. */
  authRateLimit?: { max: number; timeWindowMs: number };
}

/**
 * Application bootstrap: infrastructure concerns only (server, error shape,
 * logging, docs, health). Every gameplay feature registers itself through a
 * feature module in `modules/` — see docs/architecture.md.
 */
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const { env, prisma } = deps;
  const authRateLimit = deps.authRateLimit ?? { max: 10, timeWindowMs: 60_000 };

  const app = Fastify({
    logger: buildLoggerOptions(env),
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Generic errors in production: internal details are logged, never returned.
  app.setErrorHandler((error: FastifyError | DomainError, request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, requestId: request.id },
      });
    }
    const prismaCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
    if (prismaCode === 'P2034') metrics.increment('transaction_retry');
    if (prismaCode === '40P01') metrics.increment('deadlock');
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
      const message =
        env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : error.message;
      return reply.status(statusCode).send({
        error: { code: 'INTERNAL_ERROR', message, requestId: request.id },
      });
    }
    return reply.status(statusCode).send({
      error: {
        code: error.code ?? 'BAD_REQUEST',
        message: error.message,
        requestId: request.id,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Resource not found.', requestId: request.id },
    });
  });

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });
  registerMutationAudit(app);

  // OpenAPI is documentation only (ADR 0002); the frontend client is never generated from it.
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Fantasy Economy RPG API',
        description: 'REST API under /api/v1. Shared Zod schemas are the contract.',
        version: '0.1.0',
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/api/v1/docs' });
  await app.register(healthRoutes, { prefix: '/api/v1', pingDatabase: deps.pingDatabase });

  // Feature modules register themselves in a fixed, explicit order.
  const timedStateFinalizers: TimedStateFinalizer[] = [];
  const services: ServiceRegistry = {};
  const context: ModuleContext = {
    app,
    env,
    prisma,
    authRateLimit,
    timedStateFinalizers,
    timedStateRunner: createTimedStateRunner(timedStateFinalizers),
    services,
  };
  for (const module of GAME_MODULES) {
    await module.register(context);
  }

  return app;
}
