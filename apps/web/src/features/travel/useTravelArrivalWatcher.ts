import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useCharacter } from '../character/useCharacter';
import { SCENE_KEY } from '../living-world/useScene';
import { DESTINATIONS_KEY, FEATURES_KEY, LOCATION_KEY } from '../location/useLocation';
import { NOTIFICATIONS_KEY } from '../notifications/useNotifications';
import { QUESTS_KEY } from '../quests/useQuests';
import { useTravelStatus } from './useTravel';

/**
 * App-level watcher: while a journey is in flight the travel-status query polls
 * and finalizes lazily server-side. When it flips from active to arrived, every
 * location-dependent read model is stale no matter which page the player is on
 * (they may be reading Quests when a delivery completes). Invalidating here — in
 * the always-mounted shell — keeps those views live without a manual reload.
 */
export function useTravelArrivalWatcher() {
  const { data: character } = useCharacter();
  const travel = useTravelStatus(Boolean(character));
  const queryClient = useQueryClient();
  const wasActive = useRef(false);

  const active = Boolean(travel.data?.active);

  useEffect(() => {
    if (active) {
      wasActive.current = true;
      return;
    }
    if (wasActive.current) {
      wasActive.current = false;
      for (const key of [
        LOCATION_KEY,
        FEATURES_KEY,
        DESTINATIONS_KEY,
        SCENE_KEY,
        QUESTS_KEY,
        NOTIFICATIONS_KEY,
        ['character', 'me'],
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    }
  }, [active, queryClient]);
}
