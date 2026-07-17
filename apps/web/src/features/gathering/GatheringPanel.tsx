import type { GatheringResult, GatheringRun } from '@rpg/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { LoadingState } from '../../components/ui/LoadingState';
import { useToast } from '../../components/ui/Toast';
import { ApiRequestError } from '../../lib/api';
import { INVENTORY_KEY } from '../inventory/useInventory';
import {
  GATHERING_ACTIONS_KEY,
  useClaimGathering,
  useGatheringActions,
  useGatheringStatus,
  useStartGathering,
} from './useGathering';

function RewardList({ result }: { result: GatheringResult }) {
  return (
    <ul className="mt-1 space-y-0.5 text-sm text-stone-900 dark:text-stone-100">
      {result.rewards.map((reward) => (
        <li key={reward.item.slug} className="font-medium">
          {reward.item.name} ×{reward.quantity}
        </li>
      ))}
    </ul>
  );
}

/** Countdown + progress bar for the active run; refetches on completion. */
function ActiveRun({ run, onDone }: { run: GatheringRun; onDone: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const doneRef = useRef(false);
  const startMs = new Date(run.startedAt).getTime();
  const endMs = new Date(run.completesAt).getTime();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (now >= endMs && !doneRef.current) {
      doneRef.current = true;
      onDone();
    }
  }, [now, endMs, onDone]);

  const remainingMs = Math.max(0, endMs - now);
  const progress =
    endMs > startMs ? Math.min(100, Math.round(((now - startMs) / (endMs - startMs)) * 100)) : 100;

  return (
    <div className="mt-3">
      <p className="mb-1 text-sm font-medium text-stone-900 dark:text-stone-100">
        {run.actionName}…
      </p>
      <div
        className="h-3 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-amber-600 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
        {remainingMs > 0 ? `${Math.ceil(remainingMs / 1000)}s remaining` : 'Finishing up…'}
      </p>
    </div>
  );
}

/**
 * Mining panel shown inside a GATHERING feature card. The reward is rolled
 * server-side at start and stays hidden until the run finalizes; this panel
 * only ever renders what the API reveals.
 */
export function GatheringPanel() {
  const actions = useGatheringActions();
  const status = useGatheringStatus();
  const startGathering = useStartGathering();
  const claimGathering = useClaimGathering();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  // Reveal a result only for runs finishing in this session, not old history.
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const watchingRef = useRef<string | null>(null);

  const active = status.data?.active ?? null;
  const held = status.data?.held ?? null;
  const lastCompleted = status.data?.lastCompleted ?? null;

  useEffect(() => {
    if (active) watchingRef.current = active.id;
    else if (watchingRef.current && lastCompleted?.id === watchingRef.current) {
      setRevealedId(watchingRef.current);
      watchingRef.current = null;
      // Finalization happened server-side during polling; refresh dependents.
      void queryClient.invalidateQueries({ queryKey: GATHERING_ACTIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['character', 'me'] });
    }
  }, [active, lastCompleted, queryClient]);

  if (actions.isPending || status.isPending) return <LoadingState label="Sizing up the rock…" />;
  if (actions.isError || status.isError || !actions.data || !status.data) return null;

  // The status skill is the fresher of the two: it reflects lazy
  // finalization that happens during polling.
  const skill = status.data.skill;

  const onStart = (actionSlug: string) => {
    setError(null);
    startGathering.mutate(
      { actionSlug, idempotencyKey: crypto.randomUUID().replaceAll('-', '') },
      {
        onError: (err) =>
          setError(err instanceof ApiRequestError ? err.message : 'You cannot start that now.'),
      },
    );
  };

  const onClaim = () => {
    setError(null);
    claimGathering.mutate(undefined, {
      onSuccess: (response) => {
        setRevealedId(response.result.id);
        showToast('Rewards claimed.', 'success');
      },
      onError: (err) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not claim the rewards.'),
    });
  };

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs font-medium text-stone-600 dark:text-stone-400">
        Mining level {skill.level}
        {skill.xpForNextLevel !== null
          ? ` — ${skill.xp} / ${skill.xpForNextLevel} XP`
          : ' (mastered)'}
      </p>

      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {active && <ActiveRun run={active} onDone={() => void status.refetch()} />}

      {held && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Your haul from {held.actionName} is waiting — make room in your pack, then claim it.
          </p>
          <RewardList result={held} />
          <Button className="mt-2" disabled={claimGathering.isPending} onClick={onClaim}>
            Claim rewards
          </Button>
        </div>
      )}

      {!active && !held && lastCompleted && revealedId === lastCompleted.id && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
          <p className="text-sm font-medium text-green-900 dark:text-green-200">
            {lastCompleted.actionName} complete! You gained {lastCompleted.xpAwarded} Mining XP.
          </p>
          <RewardList result={lastCompleted} />
        </div>
      )}

      {!active && !held && (
        <ul className="space-y-2">
          {actions.data.actions.map((action) => (
            <li
              key={action.slug}
              className="rounded-md border border-stone-200 p-3 dark:border-stone-800"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  {action.name}
                </p>
                <span className="text-xs text-stone-500 dark:text-stone-400">
                  {action.durationSeconds}s · {action.staminaCost} stamina
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-stone-400">
                {action.description}
              </p>
              {action.unlocked ? (
                <Button
                  className="mt-2"
                  disabled={startGathering.isPending}
                  onClick={() => onStart(action.slug)}
                >
                  Start work
                </Button>
              ) : (
                <p className="mt-2 text-xs font-medium text-stone-500 dark:text-stone-400">
                  Requires Mining level {action.levelRequirement}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
