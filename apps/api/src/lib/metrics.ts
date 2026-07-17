/**
 * Internal operational metrics (Phase 13B). Process-local counters with a
 * small fixed name set — no high-cardinality labels, never player-visible.
 * Consumers read snapshots (tests, logs, a future admin surface); this is
 * deliberately not a metrics framework.
 */

export const METRIC_NAMES = [
  /** A start/command replay matched an existing idempotency key. */
  'idempotency_replay',
  /** A unique-constraint race lost to a concurrent transaction (P2002). */
  'concurrency_conflict',
  /** A combat command carried a stale expected version. */
  'combat_command_conflict',
  /** A marketplace purchase lost the race for a listing. */
  'marketplace_purchase_conflict',
  /** A quest claim hit an already-claimed or contested quest. */
  'quest_claim_retry',
  /** A pg-boss worker job failed. */
  'worker_failure',
  /** One lazy timed-state finalizer execution. */
  'lazy_finalizer_run',
  /** A database transaction failed with a retryable conflict (P2034). */
  'transaction_retry',
  /** A database deadlock was reported. */
  'deadlock',
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

export interface Metrics {
  increment(name: MetricName, by?: number): void;
  snapshot(): Record<MetricName, number>;
  reset(): void;
}

export function createMetrics(): Metrics {
  const counters = new Map<MetricName, number>(METRIC_NAMES.map((name) => [name, 0]));
  return {
    increment(name, by = 1) {
      counters.set(name, (counters.get(name) ?? 0) + by);
    },
    snapshot() {
      return Object.fromEntries(counters) as Record<MetricName, number>;
    },
    reset() {
      for (const name of METRIC_NAMES) counters.set(name, 0);
    },
  };
}

/** The process-wide default instance used by services and the worker. */
export const metrics: Metrics = createMetrics();
