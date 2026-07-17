import { type HealthResponse, healthResponseSchema } from '@rpg/shared';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '../../lib/api';

/**
 * Development-only API health indicator. Renders nothing in production
 * builds; the health endpoint remains available for operational checks.
 */
export function DevHealthIndicator() {
  if (!import.meta.env.DEV) return null;
  return <DevHealthIndicatorInner />;
}

function DevHealthIndicatorInner() {
  const { data, isError } = useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: () => apiGet('/api/v1/health', (raw) => healthResponseSchema.parse(raw)),
    refetchInterval: 15_000,
    retry: false,
  });

  const state: 'ok' | 'degraded' | 'down' = isError
    ? 'down'
    : data === undefined
      ? 'down'
      : data.status === 'ok'
        ? 'ok'
        : 'degraded';

  const dotClass =
    state === 'ok' ? 'bg-green-500' : state === 'degraded' ? 'bg-amber-500' : 'bg-red-500';
  const label = state === 'ok' ? 'API healthy' : state === 'degraded' ? 'API degraded' : 'API down';

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-xs text-stone-600"
      data-testid="dev-health-indicator"
    >
      <span className={`size-2 rounded-full ${dotClass}`} aria-hidden />
      <span>{label} (dev)</span>
    </div>
  );
}
