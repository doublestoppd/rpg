# Threat Model & Security Checklist

Scope: the release candidate (Phases 0–18). Assets: player accounts and
sessions, the Gold ledger and item inventory, the marketplace, chat content and
moderation evidence, and administrator capabilities.

## Trust boundaries

- **Browser ↔ API** — untrusted client. All authority (identity, balances,
  outcomes, RNG) is server-side; the client only submits commands. Every number
  the player sees comes from an API response.
- **API ↔ PostgreSQL** — authoritative store. Row locks, conditional updates,
  and transactions enforce invariants; parameterized queries only.
- **API ↔ worker** — the worker accelerates cleanup/finalization but is never
  the sole authority (ADR 0004).
- **Operator ↔ admin surface** — privileged; gated by role + recent password
  re-auth, and every mutation is append-only audited (ADR 0010).

## Threats and mitigations

| Threat                            | Mitigation                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Credential theft / session hijack | Argon2id hashes; raw session token only in a Secure/HttpOnly cookie, hashed at rest; token rotation on login/password change; admin recent-auth. |
| CSRF                              | Per-session CSRF token + Origin allowlist on every state-changing request and WS upgrade.                                                        |
| Forged economic outcomes          | Server-authoritative RNG (never `Math.random`); idempotency keys; ledger + conditional updates; exactly-once settlement.                         |
| Privilege escalation              | No default admin; explicit out-of-band promotion; role checked on every request; recent-auth for mutations.                                      |
| Audit tampering                   | `AdminAuditLog` append-only via a database trigger (no UPDATE/DELETE).                                                                           |
| Injection                         | Prisma / parameterized SQL only; no string-built queries.                                                                                        |
| XSS via chat                      | Plain-text storage + strict text rendering (no `dangerouslySetInnerHTML`, Markdown, or linkification); control chars rejected.                   |
| Abuse / spam                      | Per-account and per-IP rate limits (auth, chat, reauth); block/report/restriction.                                                               |
| Reporter exposure                 | Reporter identity never returned by any API or shown to any player.                                                                              |
| DoS via large payloads            | 256 KB body limit; capped WS inbound frames; bounded outbound queues + slow-consumer disconnect; pagination hard limits.                         |
| Information disclosure in errors  | Production returns a generic envelope; stack traces never leave the server; logs redact tokens/passwords/cookies.                                |
| Data exfiltration via metrics     | `/metrics` token-guarded, no user-supplied labels; admin reads minimize PII (masked emails).                                                     |
| Supply-chain vulnerabilities      | `npm audit --omit=dev --audit-level=high` gate; SBOM generated; CI least-privilege + no secrets in source/images/bundles.                        |

## Security checklist (release gate)

- [x] Secure/HttpOnly/SameSite cookies; `TRUST_PROXY` set behind a proxy.
- [x] CSRF + Origin enforced on all mutations and WS upgrades.
- [x] Security headers: CSP (`default-src 'none'`), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS behind TLS.
- [x] Body limit (256 KB); pagination hard limits; WS frame/queue bounds.
- [x] Production error redaction; logs free of secrets/bodies.
- [x] Rate limits on auth, chat send/report, reauth (account + IP dimensions).
- [x] `npm audit --omit=dev --audit-level=high` clean; SBOM generated.
- [x] `AdminAuditLog` append-only enforced at the database; verified by a test.
- [x] No default admin credential; production bootstrap behind an allow flag.
- [ ] **Manual before release:** SHA-pin GitHub Action revisions and rotate any
      shared dev secret; confirm the production secret store holds
      `DATABASE_URL`, `METRICS_TOKEN`, and TLS material (never in source).
