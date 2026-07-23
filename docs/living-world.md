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
- **Seeded cast** — the world ships with a representative population: 20+ named
  NPCs and 23 placements spread across every region, with schedule variety
  (dawn-only scholars, night-watch guards, an all-hours mine cook) and a
  relocating traveler. Most carry an authored dialogue (17 trees in all); a few
  are deliberately silent ambient figures. `seed-living-world.test.ts` asserts
  these invariants as pure-data checks — representative counts, resolving
  placements and dialogue keys, and sound dialogue graphs — so a future seed
  edit that strands a reference fails fast, without a database.

### Service-availability validation

Publication rejects a schedule that strands an essential service. For each
essential `serviceType` (currently `INN` and `SHOP`) that any NPC provides, the
union of segments across all placements of NPCs providing it must cover every
world segment — an always-available NPC, or a replacement per segment. Existing
non-NPC location features (shops, the inn) remain the ultimate fallback, so a
service never becomes unreachable because one NPC is off schedule.

## Dialogue and interactions

Dialogue trees are versioned content (`DIALOGUE`), and narrative flags are
versioned, typed declarations (`NARRATIVE_FLAG`). A conversation is an
`NpcInteraction`; every choice resolves through the interaction service.

### Authoring

- A **dialogue** has an entry node and a list of nodes; each node has a speaker,
  text, and choices. A **choice** has a label, a list of typed **conditions**
  (gate its visibility) and typed **effects**, and a `to` target node (or `null`
  to end the conversation). Choices never contain code, SQL, or free
  expressions — only the declared condition/effect variants.
- **Conditions** (approved read models only): `LEVEL_AT_LEAST`, `CLASS_IS`,
  `QUEST_STATUS`, `HAS_ITEM`, `FLAG_EQUALS`, `WORLD_SEGMENT`. An unset flag reads
  as its declared default.
- **Effects** (each dispatches to the owning domain service, inside one
  transaction): `SET_FLAG` (declared flag + allowed value), `INCREMENT_FAMILIARITY`
  (bounded by `FAMILIARITY_CAP`), `EMIT_QUEST_EVENT` (a verified `NPC_INTERACTION`
  quest event through the quest sink — the only way dialogue touches quest
  progress), `GRANT_GOLD` (through the currency ledger), `RECORD_ONE_TIME`.
  Dialogue never mutates gold, inventory, quests, stats, or content directly.
- **Narrative flags** are declared with a namespace, value type, allowed values,
  and default. `SET_FLAG`/`FLAG_EQUALS` may only reference a declared flag with
  an allowed value — validation rejects anything else.

### Validation

Publication rejects a dialogue with a missing entry node, a choice targeting a
nonexistent node, an unreachable node, a cycle (unbounded loop), an unsupported
condition/effect variant (structural), a reference to a missing item/quest/flag,
or a flag set to a value outside its allowed set.

### Runtime lifecycle

- `POST /api/v1/npcs/:npcKey/interactions` starts a conversation. The NPC must be
  **present** at the character's current location and segment, and must have a
  published dialogue entry point. The NPC revision, dialogue revision, and the
  **full dialogue graph** are snapshotted into the interaction, so a later
  content publish never alters an in-progress conversation (mirrors
  `Combat.buildSnapshot`). Start is idempotent by key.
- `GET /api/v1/npc-interactions/:id` returns the current node, the
  condition-filtered choices, and the conversation history. Ownership required.
- `POST /api/v1/npc-interactions/:id/choices` resolves one choice. It is
  authorized, **version-checked** (a stale `expectedVersion` is 409), and
  **idempotent** (a replayed idempotency key returns the original outcome, even
  after the version advanced). Concurrent choices have exactly one winner (a
  conditional version bump). Conditions are re-checked authoritatively; a failing
  choice rolls the whole turn back. Effects apply in order through their owning
  services, all in one transaction — a failed effect rolls the interaction back.
- `POST /api/v1/npc-interactions/:id/close` ends the conversation.
- **Per-character memory** (`CharacterNpcState`): first-met, last-interacted,
  interaction count, bounded familiarity, and last completed dialogue. Flags live
  in `CharacterNpcFlag` (typed, one row per declared flag). Not a free key/value
  bag. A retired NPC refuses new interactions but never invalidates records.

## World events, activity, and the scene

World events are versioned content (`WORLD_EVENT`) projected into
`WorldEventDefinition`. Recurrence is a pure function of the world-cycle number:
an event occurs in cycles where `(cycle − offsetCycles) % everyCycles == 0` and
stays active for `durationCycles`. There is no scheduler state.

- **Occurrences** are persisted once per `(eventKey, startCycle)` with the
  definition's fields snapshotted in, so a later revision publish never mutates
  an active occurrence. They are finalized lazily on read and are
  timestamp-authoritative (`startsAt`/`endsAt`) — correct with the worker
  stopped. `GET /api/v1/world/events`.
- **Local activity** (`GET /api/v1/locations/current/activity`) is a bounded,
  read-time projection over verified domain records — marketplace sales, museum
  donations, shop restocks, and world-event starts. It fabricates nothing,
  duplicates nothing, and blocks no gameplay transaction, and it exposes only
  typed template parameters (item/shop/collection names, quantities) — never
  account or character identifiers, names, or balances.
- **The scene** (`GET /api/v1/locations/current/scene`) is one coherent read
  model — location, time segment, cycle, atmosphere, active events, present
  NPCs, present players, features, a bounded activity summary, and an authored
  flavor line (see below) — composed under a single `now`. Its documented query
  budget is roughly a dozen index-backed reads.
- **Dynamic scene variants** give a place a different authored line by the hour
  and the weather. A `SceneVariantDefinition` has a location, a priority, and up
  to three optional conditions — `segment`, `weather`, and an `eventType` that
  matches when a world event of that type is active. A null condition matches
  anything; a variant applies only when _every_ non-null condition matches the
  current scene, and the highest-priority match wins (ties break by key). The
  chosen `narration` (or null) rides on the scene response. Selection is a pure
  function of the published rows and the same conditions the rest of the scene
  already resolved — deterministic, worker-independent, and presentation-only
  (a variant never changes a gameplay outcome). Variants are versioned content
  (`SCENE_VARIANT`): each references its location, and a variant that targets an
  unpublished location is an `UNRESOLVED_REFERENCE` at validation. They are
  authored, validated, and shipped through the Content Studio like every other
  content type, and the initial set is seeded as PUBLISHED.
- **Player presence** is a read-activity heartbeat: viewing the scene touches
  the caller's `Character.lastSeenAt`, and the scene lists the _other_ players
  whose `lastSeenAt` at the same location is within the last five minutes
  (capped, newest first, backed by the `(currentLocationId, lastSeenAt)` index).
  "Present" therefore means _actively looking at the place_, not merely logged
  in. Only public character identity (name, class, level — the same shown in
  chat and combat) is exposed; the account behind a character is never revealed,
  and the caller never appears in their own list. NPCs and players are distinct:
  NPCs are authored content, players are live presence, and neither ever crosses
  into player chat.

## The living-scene UI

The location hub renders the scene read model directly, so a place looks
different by time of day and by what is happening in it.

- **Atmosphere banner** — the current world-time segment (with a dawn/day/dusk/
  night glyph), the weather, and a row of atmosphere chips (temperature, wind,
  crowd, and reduced visibility when present). A "Happening now" panel lists any
  active world events. Presentation-only, matching the server contract.
- **People here** — the NPCs present at this location and segment (the scene's
  `npcs` filtered to `PRESENT`), each with a portrait and a **Talk** action.
- **Conversation** — Talk opens an accessible dialogue modal built on the native
  `<dialog>` (focus trapped, Escape closes). The transcript is a polite live
  region so each new line is announced; choices are ordinary buttons in document
  order. Every choice submits the interaction's current `version` and a fresh
  idempotency key, so a stale or replayed turn is resolved server-side, never in
  the client. NPCs are game characters and live only on the scene — never in
  player chat.
- **Local happenings** — the privacy-safe activity feed, each entry rendered
  client-side from its typed, anonymous parameters.

The scene is fetched once per location view and gently re-polled so a segment
change or a newly-active event appears without a manual reload.

### Runbook — world-event finalization

Watch `world_event_lazy_finalization` and `world_event_occurrence_conflict`.

- **An event that should be active isn't showing.** Confirm the cycle math:
  `GET /world/time` gives the current cycle id; the event fires only when
  `(cycle − offset) % every == 0`. Reading `/world/events` finalizes any due
  occurrence — no worker action needed.
- **`world_event_occurrence_conflict` climbing.** Benign: concurrent first-touch
  readers of the same cycle race to insert; the losers re-read the winning row.
- **A published edit didn't change a live event.** Expected — occurrences
  snapshot the definition. The edit applies to the next occurrence, not the
  current one.

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
