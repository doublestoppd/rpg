import type { LocationFeatureType } from '@rpg/shared';
import { Link, Navigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useToast } from '../components/ui/Toast';
import { useCharacter } from '../features/character/useCharacter';
import { EncounterPanel } from '../features/combat/EncounterPanel';
import { CraftingPanel } from '../features/crafting/CraftingPanel';
import { useInnRest } from '../features/currency/useCurrency';
import { GatheringPanel } from '../features/gathering/GatheringPanel';
import { ActivityFeed } from '../features/living-world/ActivityFeed';
import { NpcsPanel } from '../features/living-world/NpcsPanel';
import { SceneAtmosphere } from '../features/living-world/SceneAtmosphere';
import { useScene } from '../features/living-world/useScene';
import { LocationArtwork } from '../features/location/LocationArtwork';
import { useCurrentLocation, useLocationFeatures } from '../features/location/useLocation';
import { MuseumPanel } from '../features/museum/MuseumPanel';
import { useLocalShops } from '../features/npc-shops/useNpcShops';
import { ActiveTravelCard, DestinationList } from '../features/travel/TravelSection';
import { useTravelStatus } from '../features/travel/useTravel';

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

/**
 * The current-location page is the gameplay hub: local activities appear here
 * as feature cards rather than global navigation destinations, and the roads
 * leading out are actionable here too — location and travel are one screen.
 */
function InnRestAction() {
  const innRest = useInnRest();
  const { showToast } = useToast();
  return (
    <Button
      className="mt-3"
      disabled={innRest.isPending}
      onClick={() =>
        innRest.mutate(
          { idempotencyKey: crypto.randomUUID().replaceAll('-', '') },
          {
            onSuccess: (result) =>
              showToast(`You feel restored. Paid ${result.feePaid} Gold.`, 'success'),
            onError: (err) =>
              showToast(
                err instanceof Error ? err.message : 'The innkeeper turns you away.',
                'error',
              ),
          },
        )
      }
    >
      Rest (level-scaled fee)
    </Button>
  );
}

export function LocationPage() {
  const { data: character, isPending: characterPending } = useCharacter();
  const travel = useTravelStatus(Boolean(character));
  const atLocation = Boolean(character) && travel.data?.active === null;
  const location = useCurrentLocation(atLocation);
  const features = useLocationFeatures(atLocation);
  const localShops = useLocalShops(atLocation);
  const scene = useScene(atLocation);

  if (characterPending) return <LoadingState label="Finding your bearings…" />;
  if (!character) return <Navigate to="/character/new" replace />;

  // A traveling character is at neither origin nor destination: the journey
  // itself is the whole screen until they arrive.
  if (travel.data?.active) {
    return (
      <div className="mx-auto max-w-2xl">
        <ActiveTravelCard travel={travel.data.active} />
      </div>
    );
  }

  if (travel.isPending || location.isPending)
    return <LoadingState label="Finding your bearings…" />;
  if (location.isError || !location.data)
    return <ErrorState onRetry={() => void location.refetch()} />;

  const current = location.data.location;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <LocationArtwork slug={current.slug} name={current.name} />

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

      {scene.data && (
        <SceneAtmosphere
          segment={scene.data.segment}
          atmosphere={scene.data.atmosphere}
          events={scene.data.events}
        />
      )}

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
                {feature.type === 'INN' && <InnRestAction />}
                {feature.type === 'GATHERING' && <GatheringPanel />}
                {feature.type === 'CRAFTING' && <CraftingPanel />}
                {feature.type === 'COMBAT' && <EncounterPanel />}
                {feature.type === 'MUSEUM' && <MuseumPanel />}
                {feature.type === 'NPC_SHOP' &&
                  (() => {
                    const shop = localShops.data?.shops.find((s) => s.name === feature.name);
                    return shop ? (
                      <Link
                        to={`/shops/${shop.id}`}
                        className="mt-3 inline-block text-sm font-medium text-amber-800 hover:underline dark:text-amber-400"
                      >
                        Browse wares →
                      </Link>
                    ) : null;
                  })()}
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

      {scene.data && (
        <section aria-label="People here" className="space-y-3">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">People here</h2>
          <NpcsPanel npcs={scene.data.npcs} />
        </section>
      )}

      {scene.data && (
        <section aria-label="Local happenings" className="space-y-3">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
            Local happenings
          </h2>
          <ActivityFeed entries={scene.data.activity} />
        </section>
      )}

      <section aria-label="Roads from here" className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
            Roads from here
          </h2>
          <Link
            to="/map"
            className="text-sm font-medium text-amber-800 hover:underline dark:text-amber-400"
          >
            View the map →
          </Link>
        </div>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Travel cannot be canceled once you set out.
        </p>
        <DestinationList enabled={atLocation} />
      </section>
    </div>
  );
}
