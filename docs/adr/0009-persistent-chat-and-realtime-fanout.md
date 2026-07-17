# ADR 0009 — Persistent player chat and PostgreSQL-assisted fan-out

Status: accepted (Phase 16)

## Context

Phase 16 adds player chat: a persistent global channel and one channel per
world location, with abuse controls (blocking, reporting, restrictions) and
real-time delivery. Earlier phases established that PostgreSQL rows are
authoritative and that WebSockets are a best-effort enhancement over REST +
polling (ADR 0004, Phase 15). Chat must keep that property while adding
cross-API-instance delivery, since production runs more than one API process
behind a load balancer without sticky sessions.

## Decision

**Persistence is authoritative; real-time is a hint.** A `ChatMessage` row is
created and committed before anything is broadcast. Clients read history and
unread state through the REST API, which polls on an interval. Losing the
socket, or an entire API instance never seeing an event, costs latency only —
a forward poll from the client's last cursor closes every gap.

**One socket, additive envelope.** Chat reuses the Phase 15 authenticated
`/api/v1/notifications/ws` socket rather than opening a second transport. The
socket now carries a small discriminated-union of envelope events; chat adds
`chat.message.created`, which contains identifiers only (`eventId`,
`channelId`, `messageId`, `occurredAt`) and never message text. Clients fetch
the message body over the authorized REST API.

**Cross-instance fan-out via PostgreSQL LISTEN/NOTIFY.** After a message
commits, the origin instance delivers to its own local sockets and issues a
`pg_notify` on a fixed channel with an identifier-only payload. Every API
instance holds one dedicated `LISTEN` connection; on a notification it
delivers to its authorized local sockets (re-checking location membership and
blocks server-side). The listener reconnects with capped backoff after a drop.
NOTIFY is explicitly **not** storage and **not** a durable queue: a missed
notification is repaired by client polling. This keeps multi-instance delivery
without adding Redis or a message broker (repo invariant).

**Server authority for identity and membership.** The server derives author,
character, and channel membership on every request. Location-channel access
runs the established lazy travel finalization first, then checks the
character's authoritative current location: starting travel revokes
location-chat access, and arrival grants only the destination channel. The
client never submits an author id, location id, timestamp, status, or read
count.

**Safety is enforced at the domain layer.** Message bodies are normalized and
validated (Unicode plain text, control characters rejected, 1–500 code points,
≤2000 UTF-8 bytes) and stored verbatim; clients render strictly as text.
Sending is idempotent per author + key and rate-limited by token buckets per
account and per IP. Blocks are unilateral and invisible to the blocked player.
Reports store an immutable evidence snapshot and make the message undeletable
(the report → message relation is `RESTRICT`). Restrictions are
timestamp-authoritative and enforced lazily by the send service.

## Consequences

- Multi-instance real-time delivery with no new infrastructure; the failure
  mode of every real-time component is bounded extra latency, never lost or
  duplicated messages.
- The single socket keeps one connection per client and one authorization path
  to maintain.
- Chat correctness is testable without a worker or a socket: every generation
  and recovery test runs over plain REST, and a two-API-instance test proves
  fan-out plus polling recovery against one database.
- Retention cleanup is best-effort worker work with an allowlist of exactly one
  deletable table (`ChatMessage`, unreported only); audit and evidence records
  are never touched.
