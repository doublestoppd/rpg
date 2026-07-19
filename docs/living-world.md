# Living World (Phase 26)

The living-world layer makes locations feel alive: a world clock, regional
atmosphere, named NPCs, authored dialogue, world events, and a privacy-safe
activity feed — all server-authoritative and, where timed, worker-independent.

This document grows with the phase. Increment 1 covers the **world clock** and
**regional atmosphere**.

## World clock

World time is data-driven and derived from server time, never stored per tick and
never dependent on a worker.

- The active configuration is the highest-revision `WorldTimeConfig` row. It holds
  `cycleLengthSeconds` and `segments`: ordered `{ segment, startBps }` boundaries
  expressed as basis points (0–9999) of the cycle. The first boundary must start
  at 0. Segments are `DAWN`, `DAY`, `DUSK`, `NIGHT`.
- The current cycle id is `C<floor(epochSeconds / cycleLengthSeconds)>` — monotonic
  and timestamp-authoritative. The active segment is the last boundary the cycle
  position has passed.
- `GET /api/v1/world/time` returns the cycle id, segment, segment/cycle start and
  end timestamps, config revision, the full segment layout, and the server time.
  Clients may animate a clock locally but must reconcile against this response.
- Because time is derived, publishing a new configuration revision only affects
  time from that point forward; it never rewrites stored event or interaction
  history.

Tests inject the clock (`computeWorldTime(config, now)`), so no test depends on
real time.

## Regional atmosphere

Each region has one atmosphere per world cycle: `weather`, `intensity`,
`visibility`, `temperature`, `wind`, `crowdLevel`, and an authored
`descriptionKey`. Increment 1 atmosphere is presentation-only; any future gameplay
modifier must be explicitly configured, bounded, shown before the affected action,
and snapshotted into that action's stored inputs.

### Determinism

Atmosphere is a pure function of `(secret, region, cycleId, segment)`:

- A single `WorldSecret` row (`id = "atmosphere"`) holds server-generated random
  bytes, created lazily on first finalization and never exposed to clients.
- Each field is selected by `HMAC-SHA256(secret, "<region>:<cycleId>:<field>")`
  reduced into the field's weighted table (`apps/api/src/config/world.ts`).
- Repeated finalization for the same region and cycle therefore yields the same
  values, so the worker path and the lazy API path can never disagree.

### Finalization

`GET /api/v1/world/atmosphere` finalizes the current atmosphere for the
character's region:

1. Compute the current cycle from the world clock.
2. Return the existing `(region, cycleId)` row if present.
3. Otherwise derive the fields and `INSERT` once. The unique `(region, cycleId)`
   makes it exactly-once; a concurrent request that loses the insert race
   re-reads the identical row (deterministic derivation guarantees a match).

A worker may pre-create upcoming rows, but it is never the sole authority — the
lazy API path creates any missing current row on its own.

## Named NPCs and schedules

NPCs are versioned content (content types `NPC` and `NPC_PLACEMENT`) materialized
into the `NpcDefinition` / `NpcPlacement` projection tables, exactly like items
and shops. Availability is computed server-side.

- **NPC definition** — stable key, revision, display name, pronouns, short/long
  descriptions, descriptive roles (e.g. `INNKEEPER`, `MERCHANT`; roles grant no
  capability), portrait/scene asset keys, home region, tags, and a typed service
  association (`serviceType` + `serviceRef`) resolved by the existing domain
  services. Status is `PUBLISHED` or `RETIRED`.
- **Placement** — where and when an NPC appears: a location, the world-time
  segments it is present, a priority, and a visibility rule. An NPC may have
  several placements (relocation): e.g. a traveler who wakes in one village and
  walks a road by day.
- **Availability** — `GET /api/v1/locations/current/npcs` returns the NPCs whose
  published placement covers the character's current location and the current
  world segment, highest priority first. A traveling character has no current
  location, so the endpoint rejects. `GET /api/v1/npcs/:npcKey` returns one NPC
  with its availability for the caller (`PRESENT`, `OFF_SCHEDULE`, `ELSEWHERE`)
  and its schedule segments. A `RETIRED` NPC is never offered for a new
  interaction (404) but its row and any historical records remain.

### Service-availability validation

Publication rejects a schedule that strands an essential service. For each
essential `serviceType` (currently `INN` and `SHOP`) that any NPC provides, the
union of segments across all placements of NPCs providing it must cover every
world segment — an always-available NPC, or a replacement per segment. Existing
non-NPC location features (shops, the inn) remain the ultimate fallback, so a
service never becomes unreachable because one NPC is off schedule.

## Runbook — atmosphere finalization

Symptoms are visible through the `atmosphere_lazy_finalization` and
`atmosphere_finalization_conflict` metrics.

- **Atmosphere endpoint returns 500 / `WORLD_NOT_SEEDED`.** The character has no
  resolvable location/region. Confirm world locations are seeded; the location
  service backfills the starting location on read.
- **A region shows no atmosphere.** Expected only before the first read of that
  region in a cycle. Hitting `GET /world/atmosphere` (or the future scene endpoint)
  finalizes it. No worker action is required.
- **`atmosphere_finalization_conflict` climbing.** Benign under load — it counts
  concurrent finalizers that lost the insert race and re-read the winning row. A
  sustained high rate only indicates many first-touch reads of the same cycle
  arriving together.
- **Suspected non-determinism (two rows disagree).** Cannot happen for one
  `(region, cycleId)` — the unique prevents a second row. If atmosphere looks
  "stuck", confirm the world clock is advancing (`GET /world/time` cycle id
  changes across cycles); atmosphere only changes when the cycle does.
- **Rotating the secret.** Deleting the `WorldSecret` row re-generates it on the
  next finalization, changing all _future_ atmosphere. Existing stored rows are
  immutable and keep their values.
