import type { PrismaClient } from '@prisma/client';
import type { PresentPlayer } from '@rpg/shared';

import type { CharacterService } from '../character/character-service.js';

/** How recently a character must have viewed a place to count as "present". */
const PRESENCE_WINDOW_MS = 5 * 60 * 1000;
/** Cap on how many present players a scene lists. */
const PRESENCE_LIMIT = 20;

/**
 * Player presence (playtest note): who else is standing at a location. Presence
 * is a read-activity heartbeat — a character's `lastSeenAt` is touched whenever
 * they view the scene — so "present" means actively looking at the place, not
 * merely logged in. Only public character identity (name, class, level, the
 * same shown in chat and combat) is exposed; the account is never revealed.
 */
export interface PresenceService {
  /**
   * Touches the caller's presence at their current location, then returns the
   * other players present there within the recent window (excluding the caller).
   */
  touchAndList(userId: string, locationId: string, now: Date): Promise<PresentPlayer[]>;
}

export function createPresenceService(
  prisma: PrismaClient,
  characterService: CharacterService,
): PresenceService {
  return {
    async touchAndList(userId, locationId, now) {
      const character = await characterService.requireCharacter(userId);
      await prisma.character.update({
        where: { id: character.id },
        data: { lastSeenAt: now },
      });

      const since = new Date(now.getTime() - PRESENCE_WINDOW_MS);
      const others = await prisma.character.findMany({
        where: {
          currentLocationId: locationId,
          lastSeenAt: { gte: since },
          id: { not: character.id },
        },
        orderBy: { lastSeenAt: 'desc' },
        take: PRESENCE_LIMIT,
        select: { name: true, classSlug: true, level: true },
      });

      return others.map((row) => ({
        name: row.name,
        classSlug: row.classSlug,
        level: row.level,
      }));
    },
  };
}
