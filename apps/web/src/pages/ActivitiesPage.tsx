import type { BountyInfo } from '@rpg/shared';
import { Navigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useToast } from '../components/ui/Toast';
import { useBountyBoard, useClaimBounty } from '../features/activities/useActivities';
import { useCharacter } from '../features/character/useCharacter';
import { ApiRequestError } from '../lib/api';

const CADENCE_LABELS = { DAILY: 'Daily', WEEKLY: 'Weekly' } as const;

function BountyRow({
  bounty,
  onClaim,
  claiming,
}: {
  bounty: BountyInfo;
  onClaim: (slug: string) => void;
  claiming: boolean;
}) {
  const met = bounty.requirement.held >= bounty.requirement.quantity;
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium text-stone-900 dark:text-stone-100">
          {bounty.name}
          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal text-stone-600 dark:bg-stone-800 dark:text-stone-400">
            {CADENCE_LABELS[bounty.cadence]}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{bounty.description}</p>
        <p className="mt-1 text-xs text-stone-600 dark:text-stone-300">
          Turn in {bounty.requirement.quantity} × {bounty.requirement.itemName}{' '}
          <span
            className={
              met ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
            }
          >
            (you hold {bounty.requirement.held})
          </span>{' '}
          · reward{' '}
          <span className="font-semibold text-amber-800 dark:text-amber-400">
            {bounty.rewardGold} Gold
          </span>
          {bounty.rewardReputation > 0 ? ` · +${bounty.rewardReputation} ${bounty.region} rep` : ''}
        </p>
      </div>
      <div className="shrink-0">
        {bounty.claimed ? (
          <span className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
            Claimed
          </span>
        ) : (
          <Button
            variant="secondary"
            className="px-3 py-1 text-xs"
            disabled={!met || claiming}
            onClick={() => onClaim(bounty.slug)}
          >
            Turn in
          </Button>
        )}
      </div>
    </li>
  );
}

export function ActivitiesPage() {
  const { data: character, isPending: characterPending } = useCharacter();
  const board = useBountyBoard(Boolean(character));
  const claim = useClaimBounty();
  const { showToast } = useToast();

  if (characterPending) return <LoadingState label="Reading the notice board…" />;
  if (!character) return <Navigate to="/character/new" replace />;
  if (board.isPending) return <LoadingState label="Reading the notice board…" />;
  if (board.isError || !board.data) return <ErrorState onRetry={() => void board.refetch()} />;

  const onClaim = (slug: string) => {
    claim.mutate(slug, {
      onSuccess: (result) =>
        showToast(`Bounty turned in for ${result.goldAwarded} Gold.`, 'success'),
      onError: (err) =>
        showToast(
          err instanceof ApiRequestError ? err.message : 'Could not turn in that bounty.',
          'error',
        ),
    });
  };

  const { bounties, reputation } = board.data;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          Bounty Board
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Rotating turn-in contracts. Each bounty can be claimed once per cycle — daily bounties
          refresh every day, weekly ones every week.
        </p>
      </div>

      {reputation.length > 0 && (
        <Card>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
            Regional reputation
          </p>
          <ul className="space-y-1">
            {reputation.map((rep) => (
              <li key={rep.region} className="flex items-center justify-between gap-2 text-sm">
                <span className="capitalize text-stone-800 dark:text-stone-200">{rep.region}</span>
                <span className="text-stone-600 dark:text-stone-400">
                  {rep.points} / {rep.cap}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {bounties.length === 0 ? (
        <EmptyState
          title="No bounties posted"
          description="The board is empty for this cycle. Check back after the next rotation."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-200 dark:divide-stone-800">
            {bounties.map((bounty) => (
              <BountyRow
                key={bounty.slug}
                bounty={bounty}
                onClaim={onClaim}
                claiming={claim.isPending}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
