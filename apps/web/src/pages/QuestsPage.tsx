import type { QuestView } from '@rpg/shared';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useToast } from '../components/ui/Toast';
import { useCharacter } from '../features/character/useCharacter';
import { setTrackedQuest, useTrackedQuestId } from '../features/quests/trackedQuestStore';
import { useAcceptQuest, useClaimQuest, useQuests } from '../features/quests/useQuests';
import { ApiRequestError } from '../lib/api';

const STATUS_LABELS: Record<QuestView['status'], string> = {
  NOT_ACCEPTED: 'Available',
  ACCEPTED: 'Accepted',
  ACTIVE: 'In progress',
  COMPLETED_UNCLAIMED: 'Complete — claim your reward',
  CLAIMED: 'Claimed',
};

const STATUS_STYLES: Record<QuestView['status'], string> = {
  NOT_ACCEPTED: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
  ACCEPTED: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  ACTIVE: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  COMPLETED_UNCLAIMED: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  CLAIMED: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
};

function QuestCard({ quest }: { quest: QuestView }) {
  const acceptQuest = useAcceptQuest();
  const claimQuest = useClaimQuest();
  const { showToast } = useToast();
  const trackedId = useTrackedQuestId();
  const [error, setError] = useState<string | null>(null);

  const isTracked = trackedId === quest.id;
  const trackable = quest.status === 'ACTIVE' || quest.status === 'ACCEPTED';

  const onAccept = () => {
    setError(null);
    acceptQuest.mutate(quest.id, {
      onError: (err) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not accept the quest.'),
    });
  };

  const onClaim = () => {
    setError(null);
    claimQuest.mutate(quest.id, {
      onSuccess: (response) => {
        const parts = [`${response.granted.xp} XP`, `${response.granted.gold} Gold`];
        for (const item of response.granted.items) parts.push(`${item.name} ×${item.quantity}`);
        showToast(`Reward claimed: ${parts.join(', ')}.`, 'success');
      },
      onError: (err) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not claim the reward.'),
    });
  };

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold text-stone-900 dark:text-stone-100">{quest.name}</p>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[quest.status]}`}
        >
          {STATUS_LABELS[quest.status]}
        </span>
      </div>
      <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
        {quest.description}
      </p>

      <ul className="mt-3 space-y-2">
        {quest.objectives.map((objective) => (
          <li key={objective.description}>
            <div className="flex items-baseline justify-between text-sm">
              <span
                className={
                  objective.completed
                    ? 'text-green-700 line-through dark:text-green-400'
                    : 'text-stone-900 dark:text-stone-100'
                }
              >
                {objective.description}
              </span>
              <span className="text-xs text-stone-500">
                {objective.currentCount}/{objective.requiredCount}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
              <div
                className={`h-full ${objective.completed ? 'bg-green-600' : 'bg-amber-500'}`}
                style={{
                  width: `${Math.min(100, Math.round((objective.currentCount / objective.requiredCount) * 100))}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-stone-600 dark:text-stone-400">
        Reward: {quest.rewards.xp} XP, {quest.rewards.gold} Gold
        {quest.rewards.items.map((item) => `, ${item.name} ×${item.quantity}`).join('')}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {quest.status === 'NOT_ACCEPTED' && (
          <Button disabled={acceptQuest.isPending} onClick={onAccept}>
            Accept quest
          </Button>
        )}
        {quest.claimable && (
          <Button disabled={claimQuest.isPending} onClick={onClaim}>
            Claim reward
          </Button>
        )}
        {trackable && (
          <Button
            variant={isTracked ? 'primary' : 'secondary'}
            onClick={() => setTrackedQuest(isTracked ? null : quest.id)}
          >
            {isTracked ? 'Tracking ✓' : 'Track in status bar'}
          </Button>
        )}
      </div>
    </Card>
  );
}

export function QuestsPage() {
  const { data: character, isPending: characterPending } = useCharacter();
  const quests = useQuests(Boolean(character));
  const [hideClaimed, setHideClaimed] = useState(false);

  if (characterPending) return <LoadingState label="Unrolling the notice board…" />;
  if (!character) return <Navigate to="/character/new" replace />;
  if (quests.isPending) return <LoadingState label="Unrolling the notice board…" />;
  if (quests.isError || !quests.data) return <ErrorState onRetry={() => void quests.refetch()} />;

  const claimedCount = quests.data.quests.filter((q) => q.status === 'CLAIMED').length;
  const visible = hideClaimed
    ? quests.data.quests.filter((q) => q.status !== 'CLAIMED')
    : quests.data.quests;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          Quests
        </h1>
        {claimedCount > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-600 dark:text-stone-400">
            <input
              type="checkbox"
              checked={hideClaimed}
              onChange={(event) => setHideClaimed(event.target.checked)}
              className="rounded border-stone-300 text-amber-600 focus:ring-amber-500 dark:border-stone-600"
            />
            Hide claimed ({claimedCount})
          </label>
        )}
      </div>
      <p className="text-sm text-stone-600 dark:text-stone-400">
        Progress counts only after you accept a quest — the world keeps its own ledger of your
        deeds.
      </p>
      {visible.length > 0 ? (
        visible.map((quest) => <QuestCard key={quest.id} quest={quest} />)
      ) : (
        <Card>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            No quests to show.{' '}
            {hideClaimed && claimedCount > 0 && 'Untick “Hide claimed” to review finished quests.'}
          </p>
        </Card>
      )}
    </div>
  );
}
