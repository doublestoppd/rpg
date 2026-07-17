import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import type { Env } from '../config/env.js';
import type { SettingsService } from '../domain/account/settings-service.js';
import type { AuthService } from '../domain/auth/auth-service.js';
import type { CharacterService } from '../domain/character/character-service.js';
import type { CombatService } from '../domain/combat/combat-service.js';
import type { CraftingService } from '../domain/crafting/crafting-service.js';
import type { CurrencyService } from '../domain/currency/currency-service.js';
import type { GatheringService } from '../domain/gathering/gathering-service.js';
import type { InnService } from '../domain/inn/inn-service.js';
import type { EquipmentService } from '../domain/inventory/equipment-service.js';
import type { InventoryService } from '../domain/inventory/inventory-service.js';
import type { LocationService } from '../domain/location/location-service.js';
import type { MarketplaceService } from '../domain/marketplace/marketplace-service.js';
import type { NpcShopService } from '../domain/npc-shop/npc-shop-service.js';
import type { QuestService } from '../domain/quest/quest-service.js';
import type { TravelService } from '../domain/travel/travel-service.js';
import type { TimedStateFinalizer, TimedStateRunner } from '../lib/timed-state.js';

/**
 * Services constructed by feature modules, in registration order. Every
 * entry is optional because it appears only once its owning module has run;
 * later modules read dependencies through `requireService`, which turns a
 * mis-ordered module list into a loud startup failure instead of a
 * mysterious undefined.
 */
export interface ServiceRegistry {
  authService?: AuthService;
  settingsService?: SettingsService;
  inventoryService?: InventoryService;
  currencyService?: CurrencyService;
  characterService?: CharacterService;
  equipmentService?: EquipmentService;
  questService?: QuestService;
  travelService?: TravelService;
  locationService?: LocationService;
  innService?: InnService;
  npcShopService?: NpcShopService;
  marketplaceService?: MarketplaceService;
  gatheringService?: GatheringService;
  craftingService?: CraftingService;
  combatService?: CombatService;
}

/** Everything a feature module may use to construct and register itself. */
export interface ModuleContext {
  app: FastifyInstance;
  env: Env;
  prisma: PrismaClient;
  /** Login/register rate limit (tests may widen it). */
  authRateLimit: { max: number; timeWindowMs: number };
  /**
   * Shared timed-state finalizer list (ADR 0004). Modules owning timed
   * state push their finalizer here during registration; the runner runs
   * whatever is registered at call time.
   */
  timedStateFinalizers: TimedStateFinalizer[];
  timedStateRunner: TimedStateRunner;
  services: ServiceRegistry;
}

/**
 * A feature module: one registration function owning route registration,
 * service construction, and dependency wiring for its feature. Explicit
 * construction in a fixed order — deliberately not a DI framework.
 */
export interface GameModule {
  readonly name: string;
  register(ctx: ModuleContext): Promise<void>;
}

/** Reads a dependency from the registry or fails fast with the fix. */
export function requireService<K extends keyof ServiceRegistry>(
  services: ServiceRegistry,
  key: K,
): NonNullable<ServiceRegistry[K]> {
  const service = services[key];
  if (!service) {
    throw new Error(
      `module composition: ${key} is not registered yet — ` +
        `check the module order in modules/index.ts`,
    );
  }
  return service;
}
