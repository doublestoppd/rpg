import { createActivityService } from '../domain/living-world/activity-service.js';
import { createInteractionService } from '../domain/living-world/interaction-service.js';
import { createNpcService } from '../domain/living-world/npc-service.js';
import { createPresenceService } from '../domain/living-world/presence-service.js';
import { createSceneService } from '../domain/living-world/scene-service.js';
import { createSceneVariantService } from '../domain/living-world/scene-variant-service.js';
import { createWorldEventService } from '../domain/living-world/world-event-service.js';
import { createAtmosphereService } from '../domain/world-sim/atmosphere-service.js';
import { createWorldClockService } from '../domain/world-sim/world-clock.js';
import { npcInteractionRoutes } from '../routes/npc-interactions.js';
import { npcRoutes } from '../routes/npcs.js';
import { sceneRoutes } from '../routes/scene.js';
import { worldSimRoutes } from '../routes/world-sim.js';
import { type GameModule, requireService } from './types.js';

/**
 * Living world (Phase 26). Increment 1: the server-authoritative world clock
 * and deterministic regional atmosphere. Both are worker-independent —
 * atmosphere is finalized lazily on read and is fully determined by a persisted
 * server secret plus the region and cycle. Registers after the world module so
 * `locationService` (for the character's current region) already exists.
 */
export const livingWorldModule: GameModule = {
  name: 'living-world',
  async register(ctx) {
    const locationService = requireService(ctx.services, 'locationService');
    const characterService = requireService(ctx.services, 'characterService');
    const inventoryService = requireService(ctx.services, 'inventoryService');
    const currencyService = requireService(ctx.services, 'currencyService');
    const questService = requireService(ctx.services, 'questService');

    const worldClock = createWorldClockService(ctx.prisma);
    const atmosphereService = createAtmosphereService(ctx.prisma, worldClock);
    const npcService = createNpcService(ctx.prisma, locationService, worldClock);
    const interactionService = createInteractionService(ctx.prisma, {
      characterService,
      inventoryService,
      currencyService,
      questEvents: questService.events,
      worldClock,
      npcService,
    });
    const worldEventService = createWorldEventService(ctx.prisma, worldClock, locationService);
    const activityService = createActivityService(ctx.prisma, locationService);
    const presenceService = createPresenceService(ctx.prisma, characterService);
    const sceneVariantService = createSceneVariantService(ctx.prisma);
    const sceneService = createSceneService({
      locationService,
      worldClock,
      atmosphereService,
      worldEventService,
      npcService,
      activityService,
      presenceService,
      sceneVariantService,
    });

    ctx.services.worldClockService = worldClock;
    ctx.services.atmosphereService = atmosphereService;
    ctx.services.npcService = npcService;
    ctx.services.interactionService = interactionService;
    ctx.services.worldEventService = worldEventService;

    await ctx.app.register(worldSimRoutes, {
      prefix: '/api/v1',
      worldClock,
      atmosphereService,
      locationService,
    });
    await ctx.app.register(npcRoutes, { prefix: '/api/v1', npcService });
    await ctx.app.register(npcInteractionRoutes, { prefix: '/api/v1', interactionService });
    await ctx.app.register(sceneRoutes, {
      prefix: '/api/v1',
      sceneService,
      worldEventService,
      activityService,
    });
  },
};
