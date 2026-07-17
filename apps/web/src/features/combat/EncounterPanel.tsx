import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { LoadingState } from '../../components/ui/LoadingState';
import { ApiRequestError } from '../../lib/api';
import { useEncounters, useStartCombat } from './useCombat';

/** Encounter list shown inside a COMBAT feature card on the location page. */
export function EncounterPanel() {
  const encounters = useEncounters();
  const startCombat = useStartCombat();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  if (encounters.isPending) return <LoadingState label="Listening to the dark…" />;
  if (encounters.isError || !encounters.data) return null;

  const activeCombatId = encounters.data.activeCombatId;

  const onStart = (encounterSlug: string) => {
    setError(null);
    startCombat.mutate(
      { encounterSlug, idempotencyKey: crypto.randomUUID().replaceAll('-', '') },
      {
        onSuccess: (view) => void navigate(`/combat/${view.id}`),
        onError: (err) =>
          setError(err instanceof ApiRequestError ? err.message : 'The fight would not start.'),
      },
    );
  };

  return (
    <div className="mt-3 space-y-2">
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {activeCombatId && (
        <Link
          to={`/combat/${activeCombatId}`}
          className="block rounded-md border border-red-300 bg-red-50 p-2 text-sm font-medium text-red-900 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          You are mid-battle — return to the fight →
        </Link>
      )}
      <ul className="space-y-2">
        {encounters.data.encounters.map((encounter) => (
          <li
            key={encounter.slug}
            className="rounded-md border border-stone-200 p-3 dark:border-stone-800"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                {encounter.name}
              </p>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                  encounter.kind === 'BOSS'
                    ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                    : encounter.kind === 'ELITE'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'
                }`}
              >
                {encounter.kind.toLowerCase()}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-stone-400">
              {encounter.description}
            </p>
            <p className="mt-1 text-xs text-stone-500">
              Foes:{' '}
              {encounter.enemies
                .map((enemy) => (enemy.count > 1 ? `${enemy.name} ×${enemy.count}` : enemy.name))
                .join(', ')}
              {!encounter.fleeable && ' — no escape'}
            </p>
            {encounter.unlocked ? (
              <Button
                className="mt-2"
                disabled={startCombat.isPending || Boolean(activeCombatId)}
                onClick={() => onStart(encounter.slug)}
              >
                Fight
              </Button>
            ) : (
              <p className="mt-2 text-xs font-medium text-stone-500 dark:text-stone-400">
                {encounter.lockedReason ?? 'Locked.'}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
