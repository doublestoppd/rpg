import { Link } from 'react-router-dom';

import { useCharacter } from '../../features/character/useCharacter';
import { useCurrentLocation } from '../../features/location/useLocation';
import { useQuests } from '../../features/quests/useQuests';
import { useTravelStatus } from '../../features/travel/useTravel';

function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'arriving';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/**
 * A slim, always-visible orientation strip shown under the header on every
 * authenticated page: where the player is (or where they are headed and how
 * long is left), and their current tracked quest. It reads the same cached
 * queries the pages use, so it costs no extra requests and stays in step with
 * the travel-arrival watcher.
 */
export function StatusBar() {
  const { data: character } = useCharacter();
  const hasCharacter = Boolean(character);
  const travel = useTravelStatus(hasCharacter);
  const location = useCurrentLocation(hasCharacter && !travel.data?.active);
  const quests = useQuests(hasCharacter);

  if (!character) return null;

  const active = travel.data?.active ?? null;
  const trackedQuest =
    quests.data?.quests.find((q) => q.status === 'ACTIVE') ??
    quests.data?.quests.find((q) => q.status === 'COMPLETED_UNCLAIMED') ??
    quests.data?.quests.find((q) => q.status === 'ACCEPTED') ??
    null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-stone-200 bg-white/70 px-4 py-2 text-sm backdrop-blur md:px-8 dark:border-stone-800 dark:bg-stone-900/70">
      {active ? (
        <Link to="/location" className="flex items-center gap-1.5 font-medium">
          <span aria-hidden>🧭</span>
          <span className="text-stone-700 dark:text-stone-200">
            Traveling to {active.destination.name}
          </span>
          <span className="text-stone-500 dark:text-stone-400">
            · {formatDuration(active.remainingSeconds)}
          </span>
        </Link>
      ) : (
        <Link to="/location" className="flex items-center gap-1.5 font-medium">
          <span aria-hidden>📍</span>
          <span className="text-stone-700 dark:text-stone-200">
            {location.data?.location.name ?? 'Finding your bearings…'}
          </span>
          {location.data && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                location.data.location.isSafe
                  ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                  : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
              }`}
            >
              {location.data.location.isSafe ? 'Safe' : 'Danger'}
            </span>
          )}
        </Link>
      )}

      <span aria-hidden className="hidden text-stone-300 sm:inline dark:text-stone-700">
        |
      </span>

      {trackedQuest ? (
        <Link
          to="/quests"
          className="flex min-w-0 items-center gap-1.5 text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
        >
          <span aria-hidden>🗒️</span>
          <span className="truncate">
            {trackedQuest.status === 'COMPLETED_UNCLAIMED' ? 'Ready to claim: ' : 'Quest: '}
            <span className="font-medium">{trackedQuest.name}</span>
          </span>
        </Link>
      ) : (
        <Link
          to="/quests"
          className="flex items-center gap-1.5 text-stone-500 hover:text-stone-800 dark:text-stone-500 dark:hover:text-stone-200"
        >
          <span aria-hidden>🗒️</span>
          <span>No active quest</span>
        </Link>
      )}
    </div>
  );
}
