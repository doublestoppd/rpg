# ADR 0013 — Content Studio and apply-on-publish

Status: accepted (Phase 20)

## Context

Phase 19 made content versioned: releases (`DRAFT`/`PUBLISHED`/`RETIRED`) hold
immutable, checksummed snapshots, and the gameplay engine keeps reading the live
definition tables. But there was no way for an administrator to _author_ new
content and make it live — Release 1 was only a snapshot of the seed. Phase 20
adds the administrator Content Studio and the mechanism that makes a published
release take effect: **apply-on-publish**.

The governing rule still holds: the production definition tables are not
unrestricted admin CRUD. Administrators edit drafts and publish revisions; they
never mutate a live definition directly.

## Decision

**The live tables stay the single runtime source of truth; publishing writes to
them.** Rather than switch the engine to read from `ContentDefinition`, a
published release is _materialized_ into the live tables it already reads
(`apply-on-publish`). This keeps every gameplay read path unchanged and makes
"content goes live with no code deploy" true by construction. Each content type
has an idempotent applier that upserts by stable key, resolving references
(location/item slugs) to primary keys; appliers run in dependency order so a
referenced row always exists first.

**Apply is upsert-only — it never deletes a live row.** Removing a definition
from a draft means the new release simply doesn't contain it; the live row
persists so historical records (inventories, transactions, combats, quests) keep
resolving. Making live content unavailable is the province of retirement, not
deletion. Publishing the full bundle is therefore a no-op for unchanged
definitions.

**Publication is atomic, validated, reauthenticated, and audited.** A publish
request presents a mandatory reason, the expected release version, and an
idempotency key, and requires recent re-authentication. Inside one transaction
the service (1) re-validates the whole bundle against every Phase 19 rule and
refuses on any error, (2) applies the bundle to the live tables, (3) flips the
release `DRAFT → PUBLISHED` with a conditional `updateMany` (the concurrency
guard), and (4) writes an append-only `AdminAuditLog` row. Because all four
share the transaction, content and audit commit or roll back together; a
validation failure leaves the live tables untouched. The audit's unique
`(actor, namespace, idempotencyKey)` makes a replayed publish return the current
release instead of publishing twice.

**Drafts are mutable and domain-validated; published definitions are immutable.**
Editing a definition validates the payload against that type's structural schema
(a domain-specific check, not a generic "any JSON" accept) and rejects a payload
whose slug disagrees with its stable key. Edits are allowed only while the
release is `DRAFT`; the Phase 19 database trigger blocks any change to a
published definition. Retirement flips `PUBLISHED → RETIRED` (audited) and never
destroys definitions. Rollback rolls a prior release _forward_ as a brand-new
published release (re-validated, re-applied) rather than rewriting history.

**The studio is additive API surface.** All authoring lives under
`/admin/content/*`: list/create releases, read/edit/remove draft definitions,
validate, diff against the published baseline, "where used", preview a
definition with its references resolved, and publish/retire/rollback. Reads and
draft edits require the `ADMIN` role; publish/retire/rollback additionally
require recent re-authentication. The OpenAPI baseline grows additively.

## Consequences

- Administrators create and ship content — a new item, location, route, shop,
  encounter, and quest — entirely through the API and UI, with no deployment;
  this is the Phase 20 acceptance test.
- The engine is still untouched, so authoring carries the same low gameplay risk
  as Phase 19: correctness lives in validation + apply, both fully tested.
- Deleting content is deliberately not offered; retirement plus upsert-only
  apply keeps historical references intact.
- The definition editor is JSON-with-domain-validation; richer per-type forms
  and a graphical world editor are layered on this same API in later work.
