import type { PrismaClient } from '@prisma/client';
import type { WorldTimeSegment } from '@rpg/shared';

/**
 * Dynamic scene variants (Phase 26): authored flavor text chosen from the
 * current conditions. Selection is a pure function of published rows plus the
 * live scene — no randomness — so it is deterministic and worker-independent.
 * Presentation only; a variant never changes a gameplay outcome.
 */
export interface SceneVariantService {
  /**
   * The highest-priority published variant whose non-null conditions all match,
   * or null. `eventTypes` are the world-event types currently active here.
   */
  selectNarration(
    locationSlug: string,
    conditions: { segment: WorldTimeSegment; weather: string; eventTypes: string[] },
  ): Promise<string | null>;
}

export function createSceneVariantService(prisma: PrismaClient): SceneVariantService {
  return {
    async selectNarration(locationSlug, { segment, weather, eventTypes }) {
      const variants = await prisma.sceneVariantDefinition.findMany({
        where: { locationSlug, status: 'PUBLISHED' },
        orderBy: [{ priority: 'desc' }, { key: 'asc' }],
      });
      const events = new Set(eventTypes);
      const match = variants.find(
        (v) =>
          (v.segment === null || v.segment === segment) &&
          (v.weather === null || v.weather === weather) &&
          (v.eventType === null || events.has(v.eventType)),
      );
      return match?.narration ?? null;
    },
  };
}
