# ADR 0011 — Safe configuration mutation and moderation evidence

Status: accepted (Phase 17)

## Context

Administrators can edit live item and shop definitions and moderate chat.
Careless edits could reinterpret existing assets (change what a stored item
_is_), silently clobber a concurrent edit, or destroy the evidence a report
relied on. Phase 17 constrains all three.

## Decision

**Structural fields are immutable; only reviewed presentation/economic fields
change.** `PATCH /admin/item-definitions/:slug` and
`PATCH /admin/npc-shops/:id/config` accept an allowlisted schema only (name,
description, base value; shop name/description/markup). Slug, stackability,
unique/instance semantics, maximum-stack, equipment-slot compatibility, effect
schema, and quest/collection eligibility are never mutable — nothing that would
reinterpret an asset a player already holds. The shop resale-spread invariant
(markup strictly above sellback) is re-checked on every edit.

**Optimistic concurrency, not last-write-wins.** Each mutable record carries a
`configVersion`. A PATCH presents `expectedVersion`; the update is an atomic
compare-and-set (`updateMany where configVersion = expected`). The single
winner increments the version; every stale writer sees `count === 0` and gets
HTTP 409 with the current version. Safety comes from the compare-and-set
itself, so a stale retry correctly returns 409 rather than silently
re-applying. Existing restocks, listings, sales, deliveries, and combat
snapshots are never rewritten — config changes apply to the next restock only,
and an admin restock request goes through the normal locked, secure-RNG,
purchase-limit restock path.

**Moderation preserves evidence; redaction is a tombstone, never a delete.**
`POST /admin/chat/messages/:id/redact` replaces only the player-visible body
with a fixed tombstone and stamps `redactedAt`/`redactedBy`, keeping the row
id, author, channel, and `(createdAt, id)` ordering intact. The immutable
`ChatReport` evidence snapshot (captured at report time) is never touched, and
the report→message relation is `RESTRICT`, so a reported message can never be
hard-deleted by retention cleanup or moderation. Restrictions are applied
through the same `ChatRestriction` the Phase 16 send service already enforces
lazily, so they take effect immediately and can be revoked without deleting
history. Every moderation action writes both an `AdminAuditLog` row and an
explicit `ChatModerationAction` record, and never reveals the reporter's
identity — not to the reported player, and not even in the admin report view.

## Consequences

- A player's stored items can never be structurally reinterpreted by a
  configuration edit; the worst case is a reviewed presentation/price change
  applied going forward.
- Concurrent admin edits are safe and observable: one wins, the rest get a
  clear 409 with the current version to retry against.
- Moderation is reversible where appropriate and always evidence-preserving;
  investigators keep the original text even after redaction and retention.
