# Data Retention Policy

Two categories: **audit/economic evidence** (retained long-term or indefinitely)
and **support/ephemeral records** (cleaned up after a window). Cleanup only ever
touches an explicit allowlist (`apps/api/src/lib/cleanup.ts` +
`apps/api/src/domain/chat/chat-cleanup.ts`).

## Retained (never deleted by cleanup)

CurrencyTransaction, ItemTransfer, ItemDestruction, MarketplaceSale, delivery
records, CharacterCollectionDonation, AdminAuditLog, ChatModerationAction, and
ChatReport (with its immutable evidence snapshot). A reported ChatMessage is
undeletable while a report references it (RESTRICT relation).

## Cleaned up (best-effort worker jobs)

| Record                   | Window (env)                       | Rule                                                                          |
| ------------------------ | ---------------------------------- | ----------------------------------------------------------------------------- |
| Visible chat messages    | `CHAT_RETENTION_DAYS` (90)         | Unreported messages older than the window, in batches.                        |
| Expired/revoked sessions | `SESSION_RETENTION_DAYS` (30)      | Only past-window expired or revoked rows.                                     |
| Read notifications       | `NOTIFICATION_RETENTION_DAYS` (30) | Only READ notifications older than the window; unread kept regardless of age. |

All cleanup is batched, idempotent, and best-effort — correctness never depends
on it. The deletable-table allowlist is enforced in code and covered by a test.
