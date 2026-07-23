import type { SceneResponse } from '@rpg/shared';

import type { LocationService } from '../location/location-service.js';
import type { AtmosphereService } from '../world-sim/atmosphere-service.js';
import type { WorldClockService } from '../world-sim/world-clock.js';
import type { ActivityService } from './activity-service.js';
import type { NpcService } from './npc-service.js';
import type { PresenceService } from './presence-service.js';
import type { SceneVariantService } from './scene-variant-service.js';
import type { WorldEventService } from './world-event-service.js';

/**
 * The coherent current-scene read model (Phase 26, increment 4): one response
 * containing everything the browser needs to render the initial scene —
 * location, world time, atmosphere, active events, present NPCs, features, and
 * a bounded activity summary — so the client never assembles the scene from
 * many requests. Composed from the owning services (each already index-backed;
 * the documented budget for this endpoint is ~12 queries: location resolution +
 * clock config + atmosphere + event definitions/occurrences + placements +
 * features + four activity projections).
 */
export interface SceneService {
  currentScene(userId: string): Promise<SceneResponse>;
}

export function createSceneService(deps: {
  locationService: LocationService;
  worldClock: WorldClockService;
  atmosphereService: AtmosphereService;
  worldEventService: WorldEventService;
  npcService: NpcService;
  activityService: ActivityService;
  presenceService: PresenceService;
  sceneVariantService: SceneVariantService;
}): SceneService {
  const {
    locationService,
    worldClock,
    atmosphereService,
    worldEventService,
    npcService,
    activityService,
    presenceService,
    sceneVariantService,
  } = deps;

  return {
    async currentScene(userId) {
      const now = new Date();
      // One `now` for the whole scene, so time, atmosphere, events, and NPC
      // availability are mutually consistent within the response.
      const { location } = await locationService.getCurrentLocation(userId);
      const time = await worldClock.currentTime(now);
      const [atmosphere, events, npcList, featuresResponse, activity, players] = await Promise.all([
        atmosphereService.finalizeCurrent(location.region, now),
        worldEventService.activeEvents(location.region, now),
        npcService.listAtCurrentLocation(userId, now),
        locationService.getCurrentFeatures(userId),
        activityService.recentAt(location.slug, location.region, now),
        presenceService.touchAndList(userId, location.id, now),
      ]);

      // Flavor line is chosen from the same coherent conditions as the rest of
      // the scene (segment, weather, and the events already resolved above).
      const narration = await sceneVariantService.selectNarration(location.slug, {
        segment: time.segment,
        weather: atmosphere.weather,
        eventTypes: events.map((event) => event.eventType),
      });

      return {
        location,
        segment: time.segment,
        cycleId: time.cycleId,
        atmosphere,
        events,
        npcs: npcList.npcs,
        players,
        features: featuresResponse.features,
        activity,
        narration,
        serverTime: now.toISOString(),
      };
    },
  };
}
