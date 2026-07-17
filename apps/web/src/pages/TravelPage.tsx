import type { TravelState } from '@rpg/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingState } from '../components/ui/LoadingState';
import { useToast } from '../components/ui/Toast';
import { useCharacter } from '../features/character/useCharacter';
import { useTravelDestinations } from '../features/location/useLocation';
import {
  useInvalidateAfterArrival,
  useStartTravel,
  useTravelStatus,
} from '../features/travel/useTravel';
import { ApiRequestError } from '../lib/api';

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function ActiveTravel({ travel }: { travel: TravelState }) {
  const invalidateAfterArrival = useInvalidateAfterArrival();
  const { showToast } = useToast();
  const [now, setNow] = useState(() => Date.now());
  const arrivedRef = useRef(false);

  const startMs = new Date(travel.startedAt).getTime();
  const endMs = new Date(travel.completesAt).getTime();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (now >= endMs && !arrivedRef.current) {
      arrivedRef.current = true;
      showToast(`You have arrived at ${travel.destination.name}.`, 'success');
      invalidateAfterArrival();
    }
  }, [now, endMs, travel.destination.name, showToast, invalidateAfterArrival]);

  const remainingMs = Math.max(0, endMs - now);
  const progress =
    endMs > startMs ? Math.min(100, Math.round(((now - startMs) / (endMs - startMs)) * 100)) : 100;

  return (
    <Card title={`On the road to ${travel.destination.name}`}>
      <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">
        You left {travel.origin.name} and cannot use local services until you arrive. Travel cannot
        be canceled.
      </p>
      <div className="mb-1 flex justify-between text-xs text-stone-600 dark:text-stone-400">
        <span>{travel.origin.name}</span>
        <span>{travel.destination.name}</span>
      </div>
      <div
        className="h-3 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-amber-600 transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-2 text-sm font-medium text-stone-900 dark:text-stone-100">
        {remainingMs > 0
          ? `${formatSeconds(Math.ceil(remainingMs / 1000))} remaining`
          : 'Arriving…'}
      </p>
    </Card>
  );
}

export function TravelPage() {
  const { data: character, isPending: characterPending } = useCharacter();
  const status = useTravelStatus(Boolean(character));
  const destinations = useTravelDestinations(Boolean(character) && !status.data?.active);
  const startTravel = useStartTravel();
  const [error, setError] = useState<string | null>(null);

  if (characterPending) return <LoadingState label="Checking the road…" />;
  if (!character) return <Navigate to="/character/new" replace />;
  if (status.isPending) return <LoadingState label="Checking the road…" />;
  if (status.isError) return <ErrorState onRetry={() => void status.refetch()} />;

  const active = status.data.active;

  const onSetOut = (destinationSlug: string) => {
    setError(null);
    startTravel.mutate(
      { destinationSlug, idempotencyKey: crypto.randomUUID().replaceAll('-', '') },
      {
        onError: (err) =>
          setError(err instanceof ApiRequestError ? err.message : 'Could not start traveling.'),
      },
    );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
        Travel
      </h1>

      {active ? (
        <ActiveTravel travel={active} />
      ) : (
        <>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Roads lead from your current location.{' '}
            <Link
              to="/location"
              className="font-medium text-amber-800 hover:underline dark:text-amber-400"
            >
              Look around
            </Link>{' '}
            before you set out — travel cannot be canceled.
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {destinations.data ? (
            <div className="space-y-3">
              {destinations.data.destinations.map((destination) => (
                <Card key={destination.location.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-stone-900 dark:text-stone-100">
                        {destination.location.name}
                      </p>
                      <p className="text-xs text-stone-500 dark:text-stone-400">
                        {formatSeconds(destination.travelSeconds)} on foot
                        {destination.goldCost !== '0'
                          ? ` · ${destination.goldCost} Gold`
                          : ' · free'}
                        {destination.location.isSafe ? '' : ' · dangerous roads'}
                      </p>
                    </div>
                    <Button
                      onClick={() => onSetOut(destination.location.slug)}
                      disabled={startTravel.isPending}
                    >
                      Set out
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <LoadingState label="Consulting the map…" />
          )}
        </>
      )}
    </div>
  );
}
