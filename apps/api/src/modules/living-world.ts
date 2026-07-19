import { createNpcService } from '../domain/living-world/npc-service.js';
import { createAtmosphereService } from '../domain/world-sim/atmosphere-service.js';
import { createWorldClockService } from '../domain/world-sim/world-clock.js';
import { npcRoutes } from '../routes/npcs.js';
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

    const worldClock = createWorldClockService(ctx.prisma);
    const atmosphereService = createAtmosphereService(ctx.prisma, worldClock);
    const npcService = createNpcService(ctx.prisma, locationService, worldClock);

    ctx.services.worldClockService = worldClock;
    ctx.services.atmosphereService = atmosphereService;
    ctx.services.npcService = npcService;

    await ctx.app.register(worldSimRoutes, {
      prefix: '/api/v1',
      worldClock,
      atmosphereService,
      locationService,
    });
    await ctx.app.register(npcRoutes, { prefix: '/api/v1', npcService });
  },
};
