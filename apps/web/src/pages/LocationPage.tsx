import { Navigate } from 'react-router-dom';

import type { LocationFeatureType } from '@rpg/shared';

import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useCharacter } from '../features/character/useCharacter';
import { LocationArtwork } from '../features/location/LocationArtwork';
import {
  useCurrentLocation,
  useLocationFeatures,
  useTravelDestinations,
} from '../features/location/useLocation';

const FEATURE_TYPE_LABELS: Record<LocationFeatureType, string> = {
  INN: 'Inn',
  NPC_SHOP: 'Shop',
  MARKETPLACE: 'Marketplace',
  GATHERING: 'Gathering',
  CRAFTING: 'Crafting',
  COMBAT: 'Combat',
  QUEST: 'Quests',
  MUSEUM: 'Museum',
};

function formatTravelTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/**
 * The current-location page is the gameplay hub: local activities appear here
 * as feature cards rather than global navigation destinations.
 */
export function LocationPage() {
  const { data: character, isPending: characterPending } = useCharacter();
  const location = useCurrentLocation(Boolean(character));
  const features = useLocationFeatures(Boolean(character));
  const destinations = useTravelDestinations(Boolean(character));

  if (characterPending) return <LoadingState label="Finding your bearings…" />;
  if (!character) return <Navigate to="/character/new" replace />;
  if (location.isPending) return <LoadingState label="Finding your bearings…" />;
  if (location.isError || !location.data)
    return <ErrorState onRetry={() => void location.refetch()} />;

  const current = location.data.location;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <LocationArtwork artworkKey={current.artworkKey} name={current.name} />

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
            {current.name}
          </h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              current.isSafe
                ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
            }`}
          >
            {current.isSafe ? 'Safe area' : 'Dangerous area'}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
          {current.description}
        </p>
      </div>

      <section aria-label="Local features" className="space-y-3">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Around here</h2>
        {features.data && features.data.features.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {features.data.features.map((feature) => (
              <Card key={feature.id}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="font-semibold text-stone-900 dark:text-stone-100">{feature.name}</p>
                  <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                    {FEATURE_TYPE_LABELS[feature.type]}
                  </span>
                </div>
                <p className="text-xs leading-5 text-stone-600 dark:text-stone-400">
                  {feature.description}
                </p>
              </Card>
            ))}
          </div>
        ) : features.isPending ? (
          <LoadingState label="Looking around…" />
        ) : (
          <EmptyState
            title="Nothing of note here"
            description="This place offers no services — just the road through it."
          />
        )}
      </section>

      <section aria-label="Connected roads" className="space-y-3">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
          Connected roads
        </h2>
        {destinations.data ? (
          <Card>
            <ul className="divide-y divide-stone-200 dark:divide-stone-800">
              {destinations.data.destinations.map((destination) => (
                <li
                  key={destination.location.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="font-medium text-stone-900 dark:text-stone-100">
                    {destination.location.name}
                  </span>
                  <span className="text-xs text-stone-500 dark:text-stone-400">
                    {formatTravelTime(destination.travelSeconds)} away
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <LoadingState label="Consulting the map…" />
        )}
      </section>
    </div>
  );
}
