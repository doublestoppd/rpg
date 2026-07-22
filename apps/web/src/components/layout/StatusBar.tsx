import type { QuestView } from '@rpg/shared';
import { Link } from 'react-router-dom';

import { useCharacter } from '../../features/character/useCharacter';
import { useCurrentLocation } from '../../features/location/useLocation';
import { useTrackedQuestId } from '../../features/quests/trackedQuestStore';
import { useQuests } from '../../features/quests/useQuests';
import { useTravelStatus } from '../../features/travel/useTravel';

function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'arriving';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/** Total progress across a quest's objectives, as a 0–100 percentage. */
export function questProgressPercent(quest: QuestView): number {
  const required = quest.objectives.reduce((sum, o) => sum + o.requiredCount, 0);
  if (required === 0) return quest.status === 'CLAIMED' ? 100 : 0;
  const current = quest.objectives.reduce(
    (sum, o) => sum + Math.min(o.currentCount, o.requiredCount),
    0,
  );
  return Math.round((current / required) * 100);
}

function Stat({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-1.5" title={`${label} ${value}/${max}`}>
      <span className="text-[10px] font-semibold uppercase text-stone-400 dark:text-stone-500">
        {label}
      </span>
      <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-stone-200 sm:block dark:bg-stone-700">
        <span className={`block h-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums text-stone-700 dark:text-stone-300">
        {value}
        <span className="text-stone-400 dark:text-stone-500">/{max}</span>
      </span>
    </div>
  );
}

/**
 * The always-visible orientation strip: where the player is (or is headed),
 * their vitals and gold, and the quest they are tracking with its progress.
 * Reads only cached queries the pages already use, so it costs no extra
 * requests and stays in step with the travel-arrival watcher.
 */
export function StatusBar() {
  const { data: character } = useCharacter();
  const hasCharacter = Boolean(character);
  const travel = useTravelStatus(hasCharacter);
  const location = useCurrentLocation(hasCharacter && !travel.data?.active);
  const quests = useQuests(hasCharacter);
  const trackedId = useTrackedQuestId();

  if (!character) return null;

  const active = travel.data?.active ?? null;
  const list = quests.data?.quests ?? [];
  const trackedQuest =
    (trackedId ? list.find((q) => q.id === trackedId) : undefined) ??
    list.find((q) => q.status === 'ACTIVE') ??
    list.find((q) => q.status === 'COMPLETED_UNCLAIMED') ??
    list.find((q) => q.status === 'ACCEPTED') ??
    null;

  const r = character.resources;

  return (
    <div className="flex flex-nowrap items-center gap-x-4 gap-y-1 overflow-x-auto px-4 py-2 text-sm md:px-6">
      {active ? (
        <Link to="/location" className="flex shrink-0 items-center gap-1.5 font-medium">
          <span aria-hidden>🧭</span>
          <span className="text-stone-700 dark:text-stone-200">→ {active.destination.name}</span>
          <span className="text-stone-500 dark:text-stone-400">
            {formatDuration(active.remainingSeconds)}
          </span>
        </Link>
      ) : (
        <Link to="/location" className="flex shrink-0 items-center gap-1.5 font-medium">
          <span aria-hidden>📍</span>
          <span className="text-stone-700 dark:text-stone-200">
            {location.data?.location.name ?? '…'}
          </span>
          {location.data && !location.data.location.isSafe && (
            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-950 dark:text-red-300">
              Danger
            </span>
          )}
        </Link>
      )}

      <span aria-hidden className="text-stone-300 dark:text-stone-700">
        |
      </span>

      <div className="flex shrink-0 items-center gap-3">
        <Stat label="HP" value={r.hp} max={r.maxHp} tone="bg-green-600" />
        <Stat label="MP" value={r.mp} max={r.maxMp} tone="bg-blue-600" />
        <Stat label="STA" value={r.stamina} max={r.maxStamina} tone="bg-amber-500" />
      </div>

      <span aria-hidden className="text-stone-300 dark:text-stone-700">
        |
      </span>

      <span className="flex shrink-0 items-center gap-1 font-medium text-amber-800 dark:text-amber-400">
        <span aria-hidden>🪙</span>
        <span className="tabular-nums">{character.gold}</span>
      </span>

      <span aria-hidden className="text-stone-300 dark:text-stone-700">
        |
      </span>

      {trackedQuest ? (
        <Link
          to="/quests"
          className="flex min-w-0 shrink-0 items-center gap-1.5 text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
        >
          <span aria-hidden>🗒️</span>
          <span className="max-w-40 truncate font-medium">{trackedQuest.name}</span>
          <span className="tabular-nums text-stone-500 dark:text-stone-400">
            {trackedQuest.status === 'COMPLETED_UNCLAIMED'
              ? 'ready'
              : `${questProgressPercent(trackedQuest)}%`}
          </span>
        </Link>
      ) : (
        <Link
          to="/quests"
          className="flex shrink-0 items-center gap-1.5 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
        >
          <span aria-hidden>🗒️</span>
          <span>No active quest</span>
        </Link>
      )}
    </div>
  );
}
