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
import { createSettingsService } from './domain/account/settings-service.js';
import { createAuthService } from './domain/auth/auth-service.js';
import { createCharacterService } from './domain/character/character-service.js';
import { createCombatService } from './domain/combat/combat-service.js';
import { createCraftingService } from './domain/crafting/crafting-service.js';
import { createCurrencyService } from './domain/currency/currency-service.js';
import { createGatheringService } from './domain/gathering/gathering-service.js';
import { createInnService } from './domain/inn/inn-service.js';
import { createEquipmentService } from './domain/inventory/equipment-service.js';
import { createInventoryService } from './domain/inventory/inventory-service.js';
import { createLocationService } from './domain/location/location-service.js';
import { createMarketplaceService } from './domain/marketplace/marketplace-service.js';
import { createNpcShopService } from './domain/npc-shop/npc-shop-service.js';
import { createTravelService } from './domain/travel/travel-service.js';
import { createTimedStateRunner } from './lib/timed-state.js';
import { DomainError } from './lib/http-errors.js';
import { buildLoggerOptions } from './lib/logger.js';
import { authPlugin } from './plugins/auth-plugin.js';
import { accountRoutes } from './routes/account.js';
import { authRoutes } from './routes/auth.js';
import { characterRoutes } from './routes/characters.js';
import { combatRoutes } from './routes/combat.js';
import { craftingRoutes } from './routes/crafting.js';
import { currencyRoutes } from './routes/currency.js';
import { gatheringRoutes } from './routes/gathering.js';
import { healthRoutes } from './routes/health.js';
import { inventoryRoutes } from './routes/inventory.js';
import { locationRoutes } from './routes/locations.js';
import { marketplaceRoutes } from './routes/marketplace.js';
import { npcShopRoutes } from './routes/npc-shops.js';
import { travelRoutes } from './routes/travel.js';

export interface AppDependencies {
  env: Env;
  prisma: PrismaClient;
  /** Resolves when the database is reachable; rejects otherwise. */
  pingDatabase: () => Promise<void>;
  /** Login/register rate limit; overridable in tests. */
  authRateLimit?: { max: number; timeWindowMs: number };
}

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

  const authService = createAuthService(prisma);
  const settingsService = createSettingsService(prisma);
  const inventoryService = createInventoryService(prisma);
  const currencyService = createCurrencyService(prisma);
  const characterService = createCharacterService(prisma, inventoryService, currencyService);
  const equipmentService = createEquipmentService(prisma, characterService, inventoryService);
  const travelService = createTravelService(prisma, characterService);
  // Registered timed-state finalizers run before location-dependent actions.
  // The array is extended below once later-phase services exist.
  const timedStateFinalizers = [travelService.finalizer];
  const timedStateRunner = createTimedStateRunner(timedStateFinalizers);
  const locationService = createLocationService(prisma, characterService, {
    async ensureAtLocation(characterId) {
      await timedStateRunner.finalizeAll(characterId);
      await travelService.assertNotTraveling(characterId);
    },
  });

  await app.register(authPlugin, { env, authService });

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
  await app.register(authRoutes, {
    prefix: '/api/v1',
    env,
    authService,
    loginRateLimit: authRateLimit,
  });
  await app.register(accountRoutes, { prefix: '/api/v1', settingsService });
  await app.register(characterRoutes, { prefix: '/api/v1', characterService });
  await app.register(locationRoutes, { prefix: '/api/v1', locationService });
  await app.register(travelRoutes, { prefix: '/api/v1', travelService });
  await app.register(inventoryRoutes, {
    prefix: '/api/v1',
    characterService,
    inventoryService,
    equipmentService,
    timedStateRunner,
  });
  const marketplaceService = createMarketplaceService(
    prisma,
    characterService,
    locationService,
    currencyService,
    inventoryService,
  );
  timedStateFinalizers.push(
    marketplaceService.deliveryFinalizer,
    marketplaceService.listingExpiryFinalizer,
  );
  const gatheringService = createGatheringService(
    prisma,
    characterService,
    locationService,
    inventoryService,
  );
  timedStateFinalizers.push(gatheringService.finalizer);
  const craftingService = createCraftingService(
    prisma,
    characterService,
    locationService,
    currencyService,
    inventoryService,
  );
  timedStateFinalizers.push(craftingService.finalizer);
  const combatService = createCombatService(
    prisma,
    characterService,
    locationService,
    currencyService,
    inventoryService,
  );
  const npcShopService = createNpcShopService(
    prisma,
    characterService,
    locationService,
    currencyService,
    inventoryService,
  );
  const innService = createInnService(
    prisma,
    characterService,
    locationService,
    currencyService,
    inventoryService,
  );
  await app.register(currencyRoutes, {
    prefix: '/api/v1',
    characterService,
    currencyService,
    innService,
  });
  await app.register(npcShopRoutes, { prefix: '/api/v1', npcShopService });
  await app.register(marketplaceRoutes, { prefix: '/api/v1', marketplaceService });
  await app.register(gatheringRoutes, { prefix: '/api/v1', gatheringService });
  await app.register(craftingRoutes, { prefix: '/api/v1', craftingService });
  await app.register(combatRoutes, { prefix: '/api/v1', combatService });

  return app;
}
