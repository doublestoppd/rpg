import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { LoadingState } from '../../components/ui/LoadingState';
import { useToast } from '../../components/ui/Toast';
import { ApiRequestError } from '../../lib/api';
import { useCollections, useDonate } from './useMuseum';

/**
 * Museum panel shown inside a MUSEUM feature card. Donations are permanent:
 * the artifact is destroyed and its entry joins the permanent collection.
 */
export function MuseumPanel() {
  const collections = useCollections();
  const donateMutation = useDonate();
  const { showToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [confirmSlug, setConfirmSlug] = useState<string | null>(null);

  if (collections.isPending) return <LoadingState label="Dusting the display cases…" />;
  if (collections.isError || !collections.data) return null;

  const collection = collections.data.collections[0];
  if (!collection) return null;

  const onDonate = (itemSlug: string) => {
    setError(null);
    setConfirmSlug(null);
    donateMutation.mutate(
      { collectionId: collection.id, itemSlug },
      {
        onSuccess: (response) =>
          showToast(`The curators accept your ${response.entry.item.name} with thanks.`, 'success'),
        onError: (err) =>
          setError(err instanceof ApiRequestError ? err.message : 'The curators decline.'),
      },
    );
  };

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-stone-600 dark:text-stone-400">
        {collection.name}: {collection.donatedCount}/{collection.totalCount} donated
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <ul className="space-y-2">
        {collection.entries.map((entry) => (
          <li
            key={entry.item.slug}
            className="rounded-md border border-stone-200 p-3 dark:border-stone-800"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                {entry.item.name}
              </p>
              {entry.donated ? (
                <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
                  On display
                </span>
              ) : (
                <span className="text-xs text-stone-500">
                  {entry.ownedCount > 0 ? `You carry ${entry.ownedCount}` : 'Not yet found'}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-stone-400">
              {entry.donated && entry.curatorNote ? entry.curatorNote : entry.item.description}
            </p>
            {!entry.donated &&
              entry.ownedCount > 0 &&
              (confirmSlug === entry.item.slug ? (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs font-medium text-red-700 dark:text-red-400">
                    Donations are permanent.
                  </span>
                  <Button
                    disabled={donateMutation.isPending}
                    onClick={() => onDonate(entry.item.slug)}
                  >
                    Donate forever
                  </Button>
                  <Button disabled={donateMutation.isPending} onClick={() => setConfirmSlug(null)}>
                    Keep it
                  </Button>
                </div>
              ) : (
                <Button
                  className="mt-2"
                  disabled={donateMutation.isPending}
                  onClick={() => setConfirmSlug(entry.item.slug)}
                >
                  Donate
                </Button>
              ))}
          </li>
        ))}
      </ul>
      <Link
        to="/collection"
        className="inline-block text-sm font-medium text-amber-800 hover:underline dark:text-amber-400"
      >
        View the full collection →
      </Link>
    </div>
  );
}
