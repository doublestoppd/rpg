import { Navigate } from 'react-router-dom';

import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useCharacter } from '../features/character/useCharacter';
import { useCollections } from '../features/museum/useMuseum';

/** Read-only collection progress; donations happen at the museum itself. */
export function CollectionPage() {
  const { data: character, isPending: characterPending } = useCharacter();
  const collections = useCollections(Boolean(character));

  if (characterPending) return <LoadingState label="Opening the catalog…" />;
  if (!character) return <Navigate to="/character/new" replace />;
  if (collections.isPending) return <LoadingState label="Opening the catalog…" />;
  if (collections.isError || !collections.data)
    return <ErrorState onRetry={() => void collections.refetch()} />;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
        Collection
      </h1>
      <p className="text-sm text-stone-600 dark:text-stone-400">
        Artifacts you donate join the museum's permanent collection — forever. The curators accept
        donations at the Museum of Regional Artifacts in Crownfall City.
      </p>
      {collections.data.collections.map((collection) => (
        <Card
          key={collection.id}
          title={`${collection.name} — ${collection.donatedCount}/${collection.totalCount}`}
        >
          <p className="mb-3 text-sm leading-6 text-stone-600 dark:text-stone-400">
            {collection.description}
          </p>
          <ul className="space-y-3">
            {collection.entries.map((entry) => (
              <li
                key={entry.item.slug}
                className={`rounded-md border p-3 ${
                  entry.donated
                    ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950'
                    : 'border-stone-200 dark:border-stone-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                    {entry.donated ? entry.item.name : '??? — an undonated artifact'}
                  </p>
                  {entry.donated && entry.donatedAt && (
                    <span className="text-xs text-stone-500">
                      Donated {new Date(entry.donatedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-stone-400">
                  {entry.donated
                    ? (entry.curatorNote ?? entry.item.description)
                    : 'Bring this artifact to the curators to reveal its story.'}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
