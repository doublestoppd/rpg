import type { PresentPlayer } from '@rpg/shared';

import { Card } from '../../components/ui/Card';

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Other players currently at this location (from the scene's presence list).
 * Public character identity only — the same name/class/level shown in chat and
 * combat. Renders nothing when the player is alone, to keep the scene quiet.
 */
export function PlayersHere({ players }: { players: PresentPlayer[] }) {
  if (players.length === 0) return null;

  return (
    <Card title={`Adventurers here (${players.length})`}>
      <ul className="flex flex-wrap gap-2">
        {players.map((player) => (
          <li
            key={player.name}
            className="flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-xs dark:bg-stone-800"
          >
            <span aria-hidden>🧑‍🤝‍🧑</span>
            <span className="font-medium text-stone-800 dark:text-stone-200">{player.name}</span>
            <span className="text-stone-500 dark:text-stone-400">
              Lv {player.level} {titleCase(player.classSlug)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
