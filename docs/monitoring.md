# Monitoring, Alerts, and Incident Runbooks

## Signals

- **Process counters** (`GET /api/v1/metrics`, OpenMetrics, token-guarded):
  `rpg_idempotency_replay_total`, `rpg_concurrency_conflict_total`,
  `rpg_combat_command_conflict_total`, `rpg_marketplace_purchase_conflict_total`,
  `rpg_quest_claim_retry_total`, `rpg_worker_failure_total`,
  `rpg_lazy_finalizer_run_total`, `rpg_transaction_retry_total`,
  `rpg_deadlock_total`, and the chat counters (`chat_message_accepted`,
  `chat_rate_limited`, `chat_authorization_rejected`, `chat_report_created`,
  `chat_socket_disconnect`, `chat_listener_reconnect`, `chat_polling_recovery`).
  Resettable operational telemetry — never financial truth.
- **Readiness** (`/api/v1/health/ready`) and **worker health** (`WORKER_HEALTH_PORT`).
- **Authoritative economy** metrics: the admin database-derived endpoints.

## Recommended alerts

| Alert                        | Condition (tune to baseline)                                 |
| ---------------------------- | ------------------------------------------------------------ |
| API readiness failing        | `/health/ready` 503 for > 1 min.                             |
| Worker heartbeat stale       | worker probe 503 (no successful poll in 5 min).              |
| Database pool exhaustion     | connection errors / elevated `transaction_retry`/`deadlock`. |
| Job backlog age              | pg-boss oldest queued job age above threshold.               |
| Finalizer conflicts spike    | `lazy_finalizer_run` + conflict counters rising sharply.     |
| Chat listener reconnects     | `chat_listener_reconnect` increasing steadily.               |
| Slow-consumer disconnects    | `chat_socket_disconnect` spike.                              |
| Elevated auth/admin failures | 401/403 rate spike on auth/admin/reauth routes.              |
| Backup failure               | scheduled backup job non-zero exit / missing artifact.       |

## Incident runbooks

**Database unavailable.** Readiness goes 503 (liveness stays 200, so the API is
not killed). Restore connectivity or fail over PostgreSQL; the app recovers
automatically. Timed state is repaired lazily on the next request (ADR 0004).

**Worker unavailable.** Gameplay stays correct (lazy finalizers). Cleanup and
expiry sweeps pause; restart the worker. No manual reconciliation needed.

**Real-time transport unavailable.** WebSocket/LISTEN failure only adds latency;
polling recovers all notifications and chat. Restart is safe; no data is lost.

**Stuck jobs.** Inspect pg-boss tables; the lazy paths already finalize state,
so it is safe to purge a wedged job and let the next request/scheduled run
handle it.

**Failed migration.** Readiness reports `migrations: pending`. Do not send
traffic. Fix forward (new migration) or restore the pre-migration backup
(`docs/backup-restore.md`).

**Suspected credential leak.** Rotate `METRICS_TOKEN` / TLS material / DB
credentials; revoke sessions (`admin:promote` revokes on promotion; broader
revocation via the session table); audit `AdminAuditLog` for unexpected actions.

**Abusive chat.** Use the moderation runbook (`docs/moderation-runbook.md`):
redact, restrict, resolve. Evidence is preserved regardless.

**Ledger/inventory discrepancy.** Run `npm run integrity:check`; investigate via
the admin investigation reads and the immutable ledgers (CurrencyTransaction,
ItemTransfer, ItemDestruction). Never edit rows directly — use audited admin
operations.
