import { type CraftingResult, type CraftingRun, PROFESSION_LABELS } from '@rpg/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { LoadingState } from '../../components/ui/LoadingState';
import { useToast } from '../../components/ui/Toast';
import { ApiRequestError } from '../../lib/api';
import { INVENTORY_KEY, useInventory } from '../inventory/useInventory';
import {
  CRAFTING_RECIPES_KEY,
  useClaimCrafting,
  useCraftingRecipes,
  useCraftingStatus,
  useStartCrafting,
} from './useCrafting';

function OutputList({ result }: { result: CraftingResult }) {
  return (
    <ul className="mt-1 space-y-0.5 text-sm text-stone-900 dark:text-stone-100">
      {result.output.map((output) => (
        <li key={output.item.slug} className="font-medium">
          {output.item.name} ×{output.quantity}
        </li>
      ))}
    </ul>
  );
}

/** Countdown + progress bar for the active run; refetches on completion. */
function ActiveRun({ run, onDone }: { run: CraftingRun; onDone: () => void }) {
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
        {run.recipeName}…
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
 * Forge panel shown inside a CRAFTING feature card. Crafting is deterministic:
 * inputs and Gold are consumed at start, the promised output arrives at
 * completion (or is held until the pack has room).
 */
export function CraftingPanel() {
  const recipes = useCraftingRecipes();
  const status = useCraftingStatus();
  const inventory = useInventory();
  const startCrafting = useStartCrafting();
  const claimCrafting = useClaimCrafting();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  // Show a completion notice only for runs finishing in this session.
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
      void queryClient.invalidateQueries({ queryKey: CRAFTING_RECIPES_KEY });
      void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['character', 'me'] });
    }
  }, [active, lastCompleted, queryClient]);

  if (recipes.isPending || status.isPending) return <LoadingState label="Stoking the fire…" />;
  if (recipes.isError || status.isError || !recipes.data || !status.data) return null;

  // The status profession is the fresher of the two: it reflects lazy
  // finalization that happens during polling.
  const profession = status.data.profession;

  const haveOf = (slug: string) =>
    inventory.data?.stacks.find((stack) => stack.item.slug === slug)?.quantity ?? 0;

  const onStart = (recipeSlug: string) => {
    setError(null);
    startCrafting.mutate(
      { recipeSlug, idempotencyKey: crypto.randomUUID().replaceAll('-', '') },
      {
        onError: (err) =>
          setError(err instanceof ApiRequestError ? err.message : 'You cannot start that now.'),
      },
    );
  };

  const onClaim = () => {
    setError(null);
    claimCrafting.mutate(undefined, {
      onSuccess: (response) => {
        setRevealedId(response.result.id);
        showToast('Finished work collected.', 'success');
      },
      onError: (err) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not collect the work.'),
    });
  };

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs font-medium text-stone-600 dark:text-stone-400">
        {PROFESSION_LABELS[profession.profession]} level {profession.level}
        {profession.xpForNextLevel !== null
          ? ` — ${profession.xp} / ${profession.xpForNextLevel} XP`
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
            Your finished {held.recipeName} work is waiting — make room in your pack, then collect
            it.
          </p>
          <OutputList result={held} />
          <Button className="mt-2" disabled={claimCrafting.isPending} onClick={onClaim}>
            Collect work
          </Button>
        </div>
      )}

      {!active && !held && lastCompleted && revealedId === lastCompleted.id && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
          <p className="text-sm font-medium text-green-900 dark:text-green-200">
            {lastCompleted.recipeName} complete! You gained {lastCompleted.xpAwarded}{' '}
            {PROFESSION_LABELS[profession.profession]} XP.
          </p>
          <OutputList result={lastCompleted} />
        </div>
      )}

      {!active && !held && (
        <ul className="space-y-2">
          {recipes.data.recipes.map((recipe) => (
            <li
              key={recipe.slug}
              className="rounded-md border border-stone-200 p-3 dark:border-stone-800"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  {recipe.name}
                </p>
                <span className="text-xs text-stone-500 dark:text-stone-400">
                  {recipe.durationSeconds}s · {recipe.goldCost} Gold
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-stone-400">
                {recipe.description}
              </p>
              <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
                Needs:{' '}
                {recipe.inputs
                  .map(
                    (input) =>
                      `${input.quantity}× ${input.item.name} (have ${haveOf(input.item.slug)})`,
                  )
                  .join(', ')}
              </p>
              <p className="mt-0.5 text-xs text-stone-600 dark:text-stone-400">
                Makes: {recipe.outputQuantity}× {recipe.outputItem.name}
              </p>
              {recipe.unlocked ? (
                <Button
                  className="mt-2"
                  disabled={startCrafting.isPending}
                  onClick={() => onStart(recipe.slug)}
                >
                  Begin crafting
                </Button>
              ) : (
                <p className="mt-2 text-xs font-medium text-stone-500 dark:text-stone-400">
                  Requires {PROFESSION_LABELS[recipe.profession]} level {recipe.levelRequirement}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
