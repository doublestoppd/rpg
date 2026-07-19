import type { NpcDefinition, NpcPlacement, PrismaClient } from '@prisma/client';
import type {
  NpcAvailability,
  NpcDetailResponse,
  NpcInfo,
  NpcListResponse,
  NpcRole,
  NpcServiceType,
  WorldTimeSegment,
} from '@rpg/shared';

import { DomainError } from '../../lib/http-errors.js';
import type { LocationService } from '../location/location-service.js';
import type { WorldClockService } from '../world-sim/world-clock.js';

/**
 * Named-NPC availability (Phase 26, increment 2). NPC presence is computed
 * server-side from the current world-time segment against published placements;
 * a retired NPC is never offered for a new interaction, and an NPC only appears
 * where and when its schedule says so.
 */

function toInfo(npc: NpcDefinition, availability: NpcAvailability): NpcInfo {
  return {
    key: npc.key,
    name: npc.name,
    pronouns: npc.pronouns,
    roles: npc.roles as NpcRole[],
    shortDescription: npc.shortDescription,
    homeRegion: npc.homeRegion,
    tags: npc.tags,
    portraitAssetKey: npc.portraitAssetKey,
    sceneAssetKey: npc.sceneAssetKey,
    serviceType: npc.serviceType as NpcServiceType,
    availability,
  };
}

export interface NpcService {
  listAtCurrentLocation(userId: string, now?: Date): Promise<NpcListResponse>;
  getNpc(userId: string, npcKey: string, now?: Date): Promise<NpcDetailResponse>;
}

export function createNpcService(
  prisma: PrismaClient,
  locationService: LocationService,
  worldClock: WorldClockService,
): NpcService {
  return {
    async listAtCurrentLocation(userId, now = new Date()) {
      // A traveling character is at no location; getCurrentLocation rejects.
      const { location } = await locationService.getCurrentLocation(userId);
      const segment = (await worldClock.currentTime(now)).segment;

      const placements = await prisma.npcPlacement.findMany({
        where: { locationSlug: location.slug, status: 'PUBLISHED', segments: { has: segment } },
        include: { npc: true },
        orderBy: { priority: 'desc' },
      });

      const npcs = placements
        .filter((p) => p.npc.status === 'PUBLISHED')
        .map((p) => toInfo(p.npc, 'PRESENT'));

      return { locationSlug: location.slug, segment, npcs };
    },

    async getNpc(userId, npcKey, now = new Date()) {
      const npc = await prisma.npcDefinition.findUnique({
        where: { key: npcKey },
        include: { placements: true },
      });
      if (!npc || npc.status !== 'PUBLISHED') {
        throw new DomainError(404, 'UNKNOWN_NPC', 'No such NPC.');
      }

      const { location } = await locationService.getCurrentLocation(userId);
      const segment = (await worldClock.currentTime(now)).segment;

      const here = npc.placements.find(
        (p: NpcPlacement) => p.locationSlug === location.slug && p.status === 'PUBLISHED',
      );
      const availability: NpcAvailability = !here
        ? 'ELSEWHERE'
        : here.segments.includes(segment)
          ? 'PRESENT'
          : 'OFF_SCHEDULE';

      const scheduleSegments = [
        ...new Set(
          npc.placements
            .filter((p: NpcPlacement) => p.status === 'PUBLISHED')
            .flatMap((p: NpcPlacement) => p.segments),
        ),
      ] as WorldTimeSegment[];

      return {
        ...toInfo(npc, availability),
        longDescription: npc.longDescription,
        scheduleSegments,
      };
    },
  };
}
