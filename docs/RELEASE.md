# Release Validation & Go/No-Go

Release candidate: Phases 0–18 (player economy RPG, chat, administration,
production hardening). This document records what the release gates verify and
the explicit decision.

## Decision: **NO-GO (conditional)**

The full automated release gate is green and every in-repo hardening criterion
is implemented and tested. **However**, several release criteria depend on an
environment this validation run cannot provide (container image build & non-root
runtime, a real two-node deployment behind a load balancer, and a
production-volume load smoke). Per the release rule — _unknown or untested
behavior is a NO-GO, not an assumed pass_ — the candidate is **NO-GO until the
environment-dependent conditions below are executed and recorded**. Nothing in
the code blocks GO; the outstanding items are operational validations.

## Verified by automated gates (green)

| Area                        | Evidence                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Formatting / lint / types   | `format:check`, `lint`, `typecheck` clean.                                                                        |
| Repository structure        | `verify:structure` passes.                                                                                        |
| API contract frozen         | `api-compat.test.ts` + `verify:baseline` (additive-only; baseline regenerated).                                   |
| Full test suite             | 324 Vitest tests across 34 files (unit + real-PostgreSQL integration + concurrency).                              |
| Clean-DB migration + seed   | `migration.test.ts`: every migration applies from empty; seed idempotent; expected counts.                        |
| Security headers            | `app.test.ts`: CSP/nosniff/frame/referrer; HSTS only when enabled.                                                |
| Liveness vs readiness       | `app.test.ts`: liveness ignores DB; readiness 200/503 on DB + migrations.                                         |
| Body limit                  | `app.test.ts`: 413 on oversized body.                                                                             |
| Metrics export              | `app.test.ts`: token-guarded; OpenMetrics text; no user labels.                                                   |
| Data-lifecycle cleanup      | `cleanup.test.ts`: allowlist enforced; batched; idempotent; unread kept.                                          |
| Integrity invariants        | `db-integrity.test.ts`: zero violations on migrated + seeded DB.                                                  |
| Backup + restore round trip | `backup-restore.test.ts`: dump → fresh DB restore → integrity → seed data intact.                                 |
| Real-time multi-instance    | `chat-realtime.test.ts`: instance-A commit invalidates an instance-B socket; polling recovers with NOTIFY unused. |
| Append-only audit           | `admin.test.ts`: DB trigger rejects UPDATE/DELETE.                                                                |
| Rate limits                 | auth, chat (account+IP), admin reauth tests.                                                                      |
| Dependency audit + SBOM     | `npm run audit:prod` → 0 vulnerabilities; `npm run sbom` (CycloneDX) generates.                                   |
| Production build            | `npm run build` emits `apps/api/dist` + `apps/web/dist`.                                                          |
| Playwright journeys         | 16 specs (core, chat, admin) green.                                                                               |

## Conditions to flip to GO (environment-dependent, not run here)

1. **Container images:** build the multi-stage API/worker images, run as
   non-root with a read-only FS, and confirm container startup + health/readiness
   probes in the target orchestrator.
2. **Two-node deployment:** run ≥2 API instances behind a load balancer (no
   sticky sessions) against one PostgreSQL; confirm notification/chat delivery
   across instances, LISTEN interruption + polling repair, and session-revocation
   socket close within the documented bound. (The mechanism is proven by
   `chat-realtime.test.ts`; this validates it on real infrastructure.)
3. **Load/volume smoke:** seed a production-like volume and record query
   counts/plans for critical pages and the admin metrics window; confirm no
   unbounded scans under load (EXPLAIN gates already assert index paths).
4. **Supply chain / secrets:** SHA-pin GitHub Action revisions; confirm the
   production secret store holds `DATABASE_URL`, `METRICS_TOKEN`, and TLS
   material, and that no secret appears in images, bundles, or logs.
5. **Backup schedule:** wire the backup script to a scheduler with encryption
   and off-host retention, and record one real restore drill.

## How to run the full gate

```bash
npm run format:check && npm run lint && npm run typecheck
npm run verify:structure && npm run verify:baseline
npm test                      # includes migration, integrity, backup/restore
npm run audit:prod && npm run sbom > sbom.cyclonedx.json
npm run build
npm run test:e2e              # Playwright
```

Tag the release candidate only from a clean tree with a reviewed OpenAPI
baseline, after conditions 1–5 are executed and recorded here.
