# Environment Reference

Every variable the API/worker read, validated at startup (`apps/api/src/config/env.ts`);
an invalid value refuses to start and lists every problem. Defaults in
parentheses. Secrets must come from a secret manager, never source control.

## Core

| Variable          | Default                        | Purpose                                                   |
| ----------------- | ------------------------------ | --------------------------------------------------------- |
| `NODE_ENV`        | development                    | `production` enables Secure cookies and generic errors.   |
| `HOST` / `PORT`   | 0.0.0.0 / 3000                 | API bind address.                                         |
| `DATABASE_URL`    | —                              | PostgreSQL connection string (required).                  |
| `LOG_LEVEL`       | info                           | pino level.                                               |
| `ALLOWED_ORIGINS` | localhost:5173, localhost:4173 | Origins allowed on state-changing requests + WS upgrades. |

## Rate limits

| Variable                        | Default | Purpose                          |
| ------------------------------- | ------- | -------------------------------- |
| `AUTH_RATE_LIMIT_MAX`           | 10/min  | Login/register per IP.           |
| `CHAT_RATE_LIMIT_BURST`         | 5       | Chat send burst per account.     |
| `CHAT_RATE_LIMIT_PER_MINUTE`    | 20      | Chat send sustained per account. |
| `CHAT_RATE_LIMIT_IP_BURST`      | 10      | Chat send burst per IP.          |
| `CHAT_RATE_LIMIT_IP_PER_MINUTE` | 60      | Chat send sustained per IP.      |
| `ADMIN_REAUTH_RATE_LIMIT_MAX`   | 10/min  | Admin reauth attempts per IP.    |

## Retention

| Variable                      | Default | Purpose                                 |
| ----------------------------- | ------- | --------------------------------------- |
| `CHAT_RETENTION_DAYS`         | 90      | Visible chat message retention (7–365). |
| `SESSION_RETENTION_DAYS`      | 30      | Expired/revoked session cleanup window. |
| `NOTIFICATION_RETENTION_DAYS` | 30      | Read-notification cleanup window.       |

Cleanup only ever deletes from an allowlist (`Session`, `Notification`,
`ChatMessage`). Audit and economic evidence are retained indefinitely.

## Administration (Phase 17)

| Variable                      | Default | Purpose                                                  |
| ----------------------------- | ------- | -------------------------------------------------------- |
| `ADMIN_REAUTH_WINDOW_MINUTES` | 10      | Recent-auth window gating admin mutations.               |
| `ADMIN_BOOTSTRAP_ENABLED`     | unset   | Must be `true` for `admin:promote` to run in production. |

## Production hardening (Phase 18)

| Variable             | Default | Purpose                                                         |
| -------------------- | ------- | --------------------------------------------------------------- |
| `TRUST_PROXY`        | false   | Proxy trust: `true`/`false`, hop count, or subnet/IP list.      |
| `ENABLE_HSTS`        | unset   | `true` sends HSTS (only behind verified TLS).                   |
| `METRICS_TOKEN`      | unset   | Bearer token guarding `GET /api/v1/metrics`; unset disables it. |
| `WORKER_HEALTH_PORT` | 0       | Worker health probe port; 0 disables.                           |
| `BUILD_VERSION`      | dev     | Build/commit id surfaced in health diagnostics.                 |
