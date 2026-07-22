import type { TravelState } from '@rpg/shared';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { LoadingState } from '../../components/ui/LoadingState';
import { useToast } from '../../components/ui/Toast';
import { useTravelDestinations } from '../location/useLocation';
import { useInvalidateAfterArrival, useStartTravel } from './useTravel';

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * The in-flight journey: an animated progress bar with a local per-second
 * countdown that reconciles against the server-authoritative completion time.
 * On arrival it toasts and invalidates the location-dependent reads (the shell's
 * arrival watcher is the redundant safety net for other pages).
 */
export function ActiveTravelCard({ travel }: { travel: TravelState }) {
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

/**
 * The actionable roads leading out of the current location, each with a "Set
 * out" control. Merged into the location hub so travel and place are one screen.
 */
export function DestinationList({ enabled = true }: { enabled?: boolean }) {
  const destinations = useTravelDestinations(enabled);
  const startTravel = useStartTravel();
  const { showToast } = useToast();

  const onSetOut = (destinationSlug: string) => {
    startTravel.mutate(
      { destinationSlug, idempotencyKey: crypto.randomUUID().replaceAll('-', '') },
      {
        onError: (err) =>
          showToast(err instanceof Error ? err.message : 'Could not start traveling.', 'error'),
      },
    );
  };

  if (!destinations.data) return <LoadingState label="Consulting the map…" />;

  return (
    <Card>
      <ul className="divide-y divide-stone-200 dark:divide-stone-800">
        {destinations.data.destinations.map((destination) => (
          <li
            key={destination.location.id}
            className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="font-medium text-stone-900 dark:text-stone-100">
                {destination.location.name}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {formatSeconds(destination.travelSeconds)} on foot
                {destination.goldCost !== '0' ? ` · ${destination.goldCost} Gold` : ' · free'}
                {destination.location.isSafe ? '' : ' · dangerous roads'}
              </p>
            </div>
            <Button
              onClick={() => onSetOut(destination.location.slug)}
              disabled={startTravel.isPending}
            >
              Set out
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
