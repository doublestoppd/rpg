# Deployment Guide

Production runs **three deployable concerns** (ADR 0007), never `docker compose`
and never the Vite dev server:

1. **Static web assets** — `apps/web/dist`, served by any web server or CDN.
2. **API process** — `npm run start:api` (Fastify).
3. **Worker process** — `npm run start:worker` (pg-boss), always separate.

All three are built by `npm run build`. PostgreSQL is the only stateful
dependency; pg-boss uses its own `pgboss` schema in the same database.

## Build and run

```bash
npm ci
npm run build                 # shared → api → static web
npm run start:api             # API (needs DATABASE_URL)
npm run start:worker          # worker (separate process/container)
```

Apply migrations before starting a new version:

```bash
npx prisma migrate deploy --schema prisma/schema.prisma
```

Seeds are idempotent and safe to re-run; they never reset live balances, stock,
roles, chat, reports, or configuration.

Snapshot the seeded content as the initial content release (idempotent; a no-op
once Release 1 exists). This does not change gameplay — the engine reads the
live tables — it records a versioned, checksummed baseline for the content
platform (Phase 19):

```bash
npm run content:release1     # needs DATABASE_URL
npm run content:validate     # optional: re-check content against publication rules
```

## Reverse proxy, TLS, and WebSockets

- Terminate TLS at the proxy and set `ENABLE_HSTS=true` so HSTS is only sent
  behind verified TLS.
- Set `TRUST_PROXY` to the proxy topology (`true`, a hop count, or a
  comma-separated subnet list) so `request.ip` (rate limiting) and secure-cookie
  detection are correct.
- Set `ALLOWED_ORIGINS` to the exact site origin(s); state-changing requests and
  WebSocket upgrades from other origins are rejected.
- Proxy `/api/v1/notifications/ws` as a WebSocket upgrade (used by notifications
  and chat).
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.

## Health probes

- **Liveness:** `GET /api/v1/health/live` — 200 whenever the process is up; does
  not touch the database (a DB outage must not restart a healthy API).
- **Readiness:** `GET /api/v1/health/ready` — 200 only when the database is
  reachable and migrations are applied; 503 otherwise. Gate traffic on this.
- **Combined (legacy):** `GET /api/v1/health` — 200/503 with database status.
- **Worker:** set `WORKER_HEALTH_PORT` to expose a non-public probe reporting
  liveness and recent pg-boss polling. Worker health is never part of gameplay
  correctness (ADR 0004).

## Containers

Build minimal multi-stage images from `node:22-bookworm-slim`, run Node as a
non-root user, mount a read-only root filesystem where practical, and expose
only the API/worker health ports. Persistent volumes are only needed for
PostgreSQL and its backups — never for the application containers.

## Graceful shutdown

Both processes handle SIGTERM/SIGINT: the API stops accepting connections,
closes live sockets and the chat PostgreSQL listener (onClose hooks), drains
in-flight requests, and force-exits after a 15s deadline; the worker stops
taking new jobs, lets pg-boss finish or safely abandon leased jobs, and closes
resources. Timed-state correctness is repaired on restart by the lazy
finalizers regardless (ADR 0004).

## Observability

- Process counters: `GET /api/v1/metrics` (OpenMetrics text) when `METRICS_TOKEN`
  is set; keep it network-private. These are resettable operational telemetry.
- Authoritative economy metrics live in the admin database-derived endpoints
  (`docs/economy-metrics.md`), never the process counters.
- `BUILD_VERSION` surfaces in liveness/readiness for release identification.

See `docs/environment.md` for every variable, `docs/backup-restore.md` for
backup/restore/rollback, `docs/monitoring.md` for alerts, and `docs/RELEASE.md`
for the go/no-go checklist.
