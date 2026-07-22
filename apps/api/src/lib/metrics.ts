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
  /** A chat message was accepted and committed. */
  'chat_message_accepted',
  /** A chat send replayed an existing author + idempotency key. */
  'chat_idempotency_replay',
  /** A chat send was rejected by the account or IP rate limit. */
  'chat_rate_limited',
  /** A chat request was rejected by channel authorization or a restriction. */
  'chat_authorization_rejected',
  /** A chat report was created. */
  'chat_report_created',
  /** A live socket was disconnected by the server (slow consumer, revoked…). */
  'chat_socket_disconnect',
  /** The cross-instance LISTEN connection was (re)established after a drop. */
  'chat_listener_reconnect',
  /** A forward-direction chat poll recovered messages without a socket. */
  'chat_polling_recovery',
  /** A missing current-cycle regional atmosphere was lazily finalized. */
  'atmosphere_lazy_finalization',
  /** An atmosphere finalization lost the insert race to a concurrent request. */
  'atmosphere_finalization_conflict',
  /** An NPC interaction was started. */
  'npc_interaction_started',
  /** A dialogue choice was accepted and committed. */
  'dialogue_choice_accepted',
  /** A dialogue choice was rejected for a stale interaction version. */
  'dialogue_choice_conflict',
  /** A dialogue choice replayed an existing interaction + idempotency key. */
  'dialogue_idempotent_replay',
  /** A dialogue choice was rejected because its conditions did not hold. */
  'dialogue_condition_failure',
  /** A due world-event occurrence was lazily finalized. */
  'world_event_lazy_finalization',
  /** A world-event occurrence lost the insert race to a concurrent request. */
  'world_event_occurrence_conflict',
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
