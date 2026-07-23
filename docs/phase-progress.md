# Phase Progress

Running log of completed build phases. Each entry records what the phase
delivered and the commands it introduced.

## Phase 26 — Living World, NPCs, and Ambient Simulation (2026-07-20)

**Status: in progress — increment 1 of a multi-increment phase.** This phase is
roughly four times the size of a normal one, so it is being delivered as
independently tested, gated increments committed to `main`. Increment 1 lands the
server-authoritative foundation the rest builds on: the deterministic world clock
and regional atmosphere.

> Sequencing note: this Living-World phase is being built before the
> Content-Operations / Balance-Lab / Trusted-Asset-Ingestion phase (labeled
> Phase 25 in its own spec), by request. That phase follows this one.

### Increment 1 — world clock and regional atmosphere (delivered)

- **Deterministic world clock.** A data-driven cycle (active `WorldTimeConfig`
  row; highest revision wins) defines the cycle length and the DAWN/DAY/DUSK/NIGHT
  segment boundaries as basis points of the cycle. The current cycle id and
  segment are **derived from server time** against that config — never stored per
  row, never dependent on a worker, and computed through an **injected clock** so
  tests drive time deterministically. `GET /api/v1/world/time` returns the cycle,
  segment, segment/cycle boundaries, config revision, and server time for client
  reconciliation. A config change only affects time from that point on, so stored
  history is never retroactively altered.
- **Regional atmosphere.** Weather, intensity, visibility, temperature, wind, and
  crowd level for each region and world cycle, plus an authored description key.
  Selection is deterministic HMAC-SHA256 over a **persisted server secret** (secure
  random bytes, created lazily, never exposed) keyed by region + cycle, so the
  atmosphere for a cycle is fixed and unpredictable without the secret. Missing
  current-cycle atmosphere is **lazily finalized on read** and stored once per
  `(region, cycleId)` (unique + insert-once); a concurrent finalizer that loses
  the insert race re-reads the identical row. `GET /api/v1/world/atmosphere`
  returns the current atmosphere for the character's region. Correct with the
  worker stopped: nothing schedules atmosphere; the API path creates it.

### Endpoints (additive)

`GET /api/v1/world/time`, `GET /api/v1/world/atmosphere`. New module `living-world`
(registers after `world`). OpenAPI baseline regenerated (additive). New metrics:
`atmosphere_lazy_finalization`, `atmosphere_finalization_conflict`.

### Tests

10 new: world-clock segment-boundary derivation and monotonic cycle ids under an
injected clock; deterministic atmosphere derivation, enum-validity invariants, and
secret-dependence; and API tests that `GET /world/time` is authoritative and
authenticated and `GET /world/atmosphere` finalizes idempotently (exactly one
stored row per region+cycle) with no worker.

### Increment 2 — named NPCs and placement schedules (delivered)

- **NPCs are versioned content.** New content types `NPC` and `NPC_PLACEMENT`
  publish through the Phase 19 platform (payload schemas, dependency edges,
  apply-on-publish appliers, export round-trip) and materialize into the
  `NpcDefinition` / `NpcPlacement` projection tables, exactly like items and
  shops. An NPC carries a stable key, revision, name, pronouns, descriptions,
  descriptive roles (no capability by themselves), portrait/scene asset keys,
  home region, tags, and a typed service association; placements carry the
  location, the world-time segments the NPC is present, priority, and visibility.
- **Server-authoritative availability.** `GET /api/v1/locations/current/npcs`
  returns the NPCs whose published placement covers the character's current
  location and the current world segment (highest priority first); a traveling
  character has no location and is rejected. `GET /api/v1/npcs/:npcKey` returns an
  NPC with its availability (`PRESENT` / `OFF_SCHEDULE` / `ELSEWHERE`) and
  schedule. A retired NPC is excluded from listings and rejects the detail lookup
  (404) without deletion. Relocation is supported (an NPC with placements at
  several locations across segments).
- **Service-availability validation.** Publication rejects a schedule that
  strands an essential service (`INN`/`SHOP`): the union of segments across the
  NPCs providing it must cover every world segment.
- **Seed.** Eight original named NPCs across Crownfall, Northmarch, and Deepvale
  with nine placements, including a scheduled relocation and off-schedule
  workers. (The full ≥20-NPC roster with dialogue is a later increment.)

### Endpoints (additive, increment 2)

`GET /api/v1/locations/current/npcs`, `GET /api/v1/npcs/:npcKey`. Content types
`NPC`, `NPC_PLACEMENT`. OpenAPI baseline regenerated (additive).

### Tests (increment 2)

13 new: content validation (essential-service coverage passes with full coverage
or a per-segment replacement; strands are rejected; missing portrait rejected;
dangling references rejected) and NPC availability (segment-scoped listing,
relocation, availability states, retired-NPC exclusion, traveling-character
rejection, endpoint auth/shape) plus EXPLAIN index-path checks for placement,
NPC-by-key, and atmosphere lookups.

### Increment 3 — dialogue, interactions, and NPC memory (delivered)

The technical heart of the phase: authored versioned dialogue with a typed
condition/effect registry, and a replay-safe, concurrency-safe, transactional
interaction lifecycle.

- **Dialogue + narrative flags as content.** New content types `DIALOGUE`
  (entry node + node/choice graph with typed conditions and effects) and
  `NARRATIVE_FLAG` (typed, bounded declarations) publish through the platform and
  materialize into projection tables. Validation rejects a missing entry, a
  choice targeting a nonexistent node, an unreachable node, a cycle (unbounded
  loop), a bad item/quest/flag reference, or a flag set outside its allowed set.
- **Typed condition/effect registry.** Conditions read only approved models
  (`LEVEL_AT_LEAST`, `CLASS_IS`, `QUEST_STATUS`, `HAS_ITEM`, `FLAG_EQUALS`,
  `WORLD_SEGMENT`); effects dispatch to owning services inside one transaction
  (`SET_FLAG`, `INCREMENT_FAMILIARITY` bounded, `EMIT_QUEST_EVENT` via the quest
  sink, `GRANT_GOLD` via the currency ledger, `RECORD_ONE_TIME`). Dialogue never
  mutates gold, inventory, quests, stats, or content directly. A new
  `TALK_TO_NPC` quest objective + `NPC_INTERACTION` event let a verified dialogue
  effect progress quests atomically.
- **Interaction lifecycle.** Starting snapshots the NPC revision, dialogue
  revision, and the full dialogue graph (stable across later content publishes),
  is idempotent by key, and requires the NPC to be present. Choices are
  ownership-checked, version-checked (409 on stale), idempotent on replay
  (original outcome returned even after the version advanced), and give exactly
  one winner among concurrent choices. Conditions are re-checked authoritatively;
  a failing choice or failing effect rolls the whole turn back. Per-character
  memory (`CharacterNpcState` + typed `CharacterNpcFlag`) is bounded, not a free
  key/value bag; a retired NPC refuses new interactions but keeps records.
- **Seed.** A five-node dialogue for the merchant Mira with a flag-gated one-time
  Gold gift, a familiarity-building branch, a level-gated branch, and a
  quest-event branch; two declared narrative flags.

### Endpoints (additive, increment 3)

`POST /api/v1/npcs/:npcKey/interactions`, `GET /api/v1/npc-interactions/:id`,
`POST /api/v1/npc-interactions/:id/choices`, `POST /api/v1/npc-interactions/:id/close`.
Content types `DIALOGUE`, `NARRATIVE_FLAG`. New metrics for interactions started,
choices accepted/conflicted/replayed, and condition failures. OpenAPI baseline
regenerated (additive).

### Tests (increment 3)

Dialogue-graph unit tests (cycle/unreachable/bad-target/dependency extraction),
dialogue content validation, and interaction lifecycle tests: start snapshots
revisions and filters gated choices; atomic effects (flag + familiarity + version
bump); Gold granted once through the currency service; replay-safe and
concurrency-safe choices (one winner, stale → 409); quest progress only via the
verified effect; retired-NPC start refused while an active interaction stays
stable; ownership + auth. Plus EXPLAIN index paths for NPC-state and
interaction-ownership lookups.

### Increment 4 — world events, activity feed, and the coherent scene (delivered)

- **World events.** New content type `WORLD_EVENT` (definitions projected into
  `WorldEventDefinition`) with recurrence expressed in world cycles: an event
  occurs in cycles where `(cycle − offset) % every == 0`, lasting
  `durationCycles`. Occurrences are **timestamp-authoritative** and finalized
  **lazily on read**, stored once per `(eventKey, startCycle)` with the
  definition's fields **snapshotted in**, so a later revision publish never
  mutates an active occurrence and everything is correct with the worker
  stopped. `GET /api/v1/world/events`.
- **Privacy-safe local activity feed.** `GET /api/v1/locations/current/activity`
  is a bounded **read-time projection** over verified domain records
  (marketplace sales, museum donations, shop restocks, world-event starts). By
  construction there are no fabricated player events (every entry has a source
  row), no duplicates (source rows are unique), nothing blocks a gameplay
  transaction (no extra writes), and entries are typed with item/shop/collection
  names and quantities only — never account ids, character ids, character names,
  or balances.
- **Coherent scene read model.** `GET /api/v1/locations/current/scene` returns
  the whole scene in one request — location, world-time segment, cycle,
  atmosphere, active events, present NPCs, features, and a bounded activity
  summary — composed from the owning services under a single `now`, so the
  browser never assembles the scene from many calls.
- **Seed.** Three world events (Crownfall market day, a harbor caravan, a
  Northmarch storm). New metrics: `world_event_lazy_finalization`,
  `world_event_occurrence_conflict`.

### Endpoints (additive, increment 4)

`GET /api/v1/world/events`, `GET /api/v1/locations/current/activity`,
`GET /api/v1/locations/current/scene`. Content type `WORLD_EVENT`. OpenAPI
baseline regenerated (additive).

### Tests (increment 4)

Recurrence math (`occurrenceWindowAt`), lazy worker-independent finalization
(idempotent, single occurrence per cycle, snapshot stable across a later edit),
the coherent scene read model (shape + agreement with the world clock + present
NPCs), and a privacy assertion that the activity feed surfaces a verified museum
donation without leaking the donor's character id or name. EXPLAIN index path for
active events by region + timestamp.

### Remaining increments (this phase's ambit)

Delivered through increment 4: the NPC content model + placement/schedule
availability; authored versioned dialogue trees with a typed condition/effect
registry and a replay-safe, concurrency-safe, transactional interaction
lifecycle; per-character NPC narrative state; versioned world events with lazy
finalization; the privacy-safe local activity feed; the coherent current-scene
read model; (increment 5) the living-scene and accessible NPC-dialogue UI —
the atmosphere/time banner, present-NPC panel, dialogue modal, and activity
feed on the location hub, with a Playwright walk-through — plus player presence
in the scene; and (increment 6) dynamic scene variants: authored flavor lines
chosen server-side from the current segment, weather, and active events, shown
on the scene banner. Still to come: Content Studio living-world editors
(including a `SCENE_VARIANT` content type) and a fuller representative seed
(more named NPCs and authored dialogues).

## Phase 24 — Repeatable Activities and Economy Loop Expansion (2026-07-19)

**Status: acceptance-core complete.** Adds a rotating bounty board with regional
reputation, equipment salvage, and NPC sellback. All four acceptance properties
are met and tested. The broader repeatable suite (regional contracts, rotating
elites, profession commissions, refinements, collection-completion rewards, an
activity calendar) is deferred within Phase 24's ambit (see ADR 0017).

### Delivered

- **Rotating bounty board**: a fixed pool of daily and weekly turn-in bounties.
  Which bounties are on the board, and the cycle they belong to, are a **pure
  function of the current timestamp** — a deterministic hash selection keyed by
  UTC day (`YYYY-MM-DD`) or ISO week (`YYYY-Www`). No rotation state is stored,
  so eligibility and the board are correct even with the worker stopped.
- **Once per character and cycle**: claiming consumes the turn-in stack (an item
  sink recording an `ItemTransfer`), credits the reward through the currency
  ledger, and writes a `BountyClaim`. A `@@unique(characterId, cycleId,
bountySlug)` plus a deterministic credit key (`cycleId:bountySlug`) make a
  re-claim an idempotent no-op — never a second consume or second payout. A
  stale claim from a past cycle never blocks the current cycle.
- **Regional reputation**: bounties award bounded reputation (`min(cap, …)`),
  upserted per region; it never exceeds `REPUTATION_CAP`.
- **Equipment salvage**: destroys an unequipped, unlisted equipment instance
  (setting `destroyedAt`, an append-only `ItemDestruction`) and grants a fixed
  material yield (an `ItemTransfer`). Both economic trails survive; ownership is
  retained so a replayed salvage resolves to `ALREADY_SALVAGED` (409) rather
  than looking like a foreign item. A net item sink.
- **NPC sellback**: sells stackable goods to a shop at
  `base × regional modifier × sellbackBps`. Because `sellbackBps` is validated
  strictly below `markupBps`, the sell price is always below the buy price — a
  guaranteed buy-then-sell arbitrage is impossible. Credit-first / remove-only-
  when-applied makes a replay neither double-pay nor double-remove.
- **UI**: a Bounties page (board + reputation, turn-in when the requirement is
  met); a Salvage action in the inventory item dialog; a Sell-to-shop section on
  the NPC shop page.

### Endpoints (additive)

`GET /api/v1/bounties`, `POST /api/v1/bounties/:slug/claims`,
`POST /api/v1/inventory/salvage`, `POST /api/v1/npc-shops/:id/sales`. OpenAPI
baseline regenerated (additive).

### Tests

7 new (1 file), covering every acceptance property: a bounty is claimable
exactly once per cycle (second claim consumes nothing and pays nothing), a
past-cycle claim does not block the current cycle, requirement-unmet is rejected;
a real buy-then-sell round trip loses Gold and arbitrage is impossible, sellback
replay is idempotent; salvage preserves both the destruction and transfer
records, and salvaging the same instance twice is rejected.

### Scope note

This is the acceptance-core. Deferred within Phase 24: regional contract chains,
rotating world elites, profession commissions, material refinement, collection-
completion rewards, and a player-facing activity calendar. See ADR 0017.

## Phase 23 — Character Builds, Progression, and Combat Depth (2026-07-19)

**Status: acceptance-core complete.** Raises the cap to 30 and adds ability
loadouts, talents, trainer respec, and a start-of-battle build snapshot with
ability cooldowns. All four acceptance properties are met and tested. Equipment
set bonuses, the broader encounter-mechanics suite, and a new gated boss are
deferred within Phase 23's ambit (see ADR 0016).

### Delivered

- **Level cap 20 → 30**: the seeded `LevelProgression` table extends to level 30
  (strictly increasing cumulative XP); the cap is the highest seeded level.
- **Builds**: each class now has six abilities with staggered unlock levels; a
  bounded loadout equips up to four unlocked ones; three talent tiers (levels
  10/20/30) each offer two mutually exclusive stat modifiers. Six-in-four plus
  talent choices give at least two viable level-30 builds per class. A
  `CharacterBuild` row holds the loadout and talents.
- **Trainer respec**: resets the loadout to class defaults and clears talents
  for a level-scaled Gold fee debited through the currency ledger. The immutable
  `RESPEC_FEE` ledger entry is the audit trail; the idempotency key makes a
  replay a no-op. Level and XP are untouched.
- **Combat build snapshot + cooldowns**: at battle start the equipped loadout,
  chosen talents (baked into player stats), and empty cooldowns are frozen into
  `Combat.buildSnapshot`. The ability command validates against the snapshot
  (not the live build) and enforces per-ability cooldown turns. Because combat
  already reads a `CombatantState` snapshot, a later content publish or a
  mid-fight respec never alters an in-progress battle.

### Endpoints (additive)

`GET /api/v1/builds/me`, `PUT /api/v1/builds/me/loadout`,
`PUT /api/v1/builds/me/talents`, `POST /api/v1/builds/me/respec`. Combat ability
views gain `cooldownTurns`/`cooldownRemaining`. OpenAPI baseline regenerated
(additive).

### Tests

8 new (1 file), one per acceptance property and more: ≥2 viable level-30 builds
per class (roster/talent config + saving two distinct loadouts), unlock
enforcement, respec exact + ledger-audited + idempotent, an active combat's
snapshot unchanged when the enemy definition changes, an ability rejected on
cooldown, a stale-version command rejected, and the level cap at 30. The engine
roster test was updated for the six-ability classes.

### Scope note

This is the acceptance-core. Deferred within Phase 23: equipment tiers with set
bonuses / deterministic affix groups; multiple waves, telegraphing,
reinforcements, conditional phases, status resistance, dispel/cleanse; and a new
gated boss to exercise them. See ADR 0016.

## Phase 22 — World Expansion: Northmarch, Herbalism, and Alchemy (2026-07-19)

**Status: complete.** The first large gameplay expansion, delivered as _content_
through the platform, with code limited to genuinely new mechanics and reusable
presentation. Acceptance test met: the Northmarch region and all its ordinary
definitions are created through the content workflow (validate → publish →
apply-on-publish); the only code changes are the Herbalism/Alchemy professions
and profession-agnostic UI labels.

### Delivered

- **Northmarch region as content** (`domain/content/expansions/northmarch.ts`):
  ~82 versioned definitions — 4 new locations (Hold, Fen, Thicket, Barrow) hung
  off the existing North Road, routes, inn/marketplace/shop/craft/quest/museum
  features, 16 items, 4 Herbalism gathering actions, 8 Alchemy recipes, 6
  enemies, 5 encounters (2 elite + 1 gated boss), 10 quests, a relic collection,
  2 NPC shops, and region-specific price modifiers. Published via
  `npm run content:expansion northmarch` (idempotent), which validates the full
  bundle and applies it to the live tables. The seed is untouched.
- **Herbalism + Alchemy mechanics**: `SkillType += HERBALISM`,
  `ProfessionType += ALCHEMY` (migration + shared schemas). Gathering and
  crafting are now multi-track — XP accrues to the action's skill / recipe's
  profession, and each surface shows progress for the profession its location
  offers. Stored-outcome, capacity-hold, lazy-finalization, idempotency, and
  worker-offline behavior are inherited unchanged from Mining/Blacksmithing.
- **Region economy**: marketplace remote delivery recognizes `northmarch`
  automatically (regions are derived from shop rows); recipe fees, reagent
  consumption, and shop markups provide Gold and material sinks. Level cap
  stays at 20.
- **Reusable presentation**: the gathering and crafting panels render the
  skill/profession name from the response (`SKILL_LABELS`, `PROFESSION_LABELS`)
  instead of hardcoding "Mining"/"Blacksmithing".

### Commands

| Command                                | Purpose                                                    |
| -------------------------------------- | ---------------------------------------------------------- |
| `npm run content:expansion northmarch` | Idempotently validate and publish the Northmarch expansion |

### Tests

4 new (1 file): the acceptance test (the expansion publishes as a release and
materializes the whole region into the live tables, including the gated boss),
idempotent re-publish, Herbalism end-to-end (gathers herbs, awards Herbalism XP
not Mining, idempotent replay), and Alchemy end-to-end (brews an elixir, awards
Alchemy XP not Blacksmithing, consumes reagents). The suite publishes into and
cleans the shared content out afterward, so file isolation holds.

### Scope note

Content counts sit at the lower end of the suggested ranges (a complete, valid,
low-level region) to keep the authored data correct and reviewable; the same
builders extend it. See ADR 0015.

## Phase 21 — Visual Asset Framework and player-UI refresh (2026-07-18)

**Status: framework complete; UI refresh foundational.** Establishes a stable
asset contract before any art: presentation is data referenced by key, not paths
baked into components. Acceptance test met — (1) every visual content reference
has a valid fallback, and (2) replacing an asset changes the presentation with
no React component change (both proven in tests).

### Delivered

- **Asset contract** (`packages/shared/assets.ts`): 13 asset roles; an asset
  definition schema (stable key, role, bundled path, aspect ratio, dimensions,
  focal point, alt text, fallback key, light/dark/regional variant, SHA-256
  checksum); a manifest with a default per role; and `AssetResolver` — a pure
  resolver that returns the keyed asset or follows the fallback chain to the
  role default, guaranteeing a valid asset for every reference (cycles broken).
- **Bundled placeholders + generator**: `scripts/generate-assets.mjs` writes a
  consistent placeholder SVG per catalog entry into `apps/web/public/assets/
game`, computes checksums, and emits the manifest. No database blobs, no
  remote URLs.
- **Build-time validation**: `scripts/verify-assets.mjs` (a CI gate and a test)
  checks every file exists, every checksum matches, every fallback chain
  terminates, and every role has a default.
- **Assets API**: `GET /api/v1/assets` serves the compiled-in manifest
  (public, cacheable) for the client and the admin asset picker.
- **Data-driven UI**: an `<Asset>` component that renders from the resolver
  (never a hardcoded path), with skeleton loading and reduced-motion handling;
  applied to illustrated location banners and inventory item icons; plus an
  admin asset gallery previewing every asset in its real render path.

### Endpoints (additive)

`GET /api/v1/assets`. OpenAPI baseline regenerated (additive).

### Commands

| Command                   | Purpose                                                 |
| ------------------------- | ------------------------------------------------------- |
| `npm run assets:generate` | Regenerate the bundled SVGs and the asset manifest      |
| `npm run assets:verify`   | Validate files, checksums, fallbacks, and role defaults |

### Tests

11 new: resolver unit tests (specific hit, unknown-key fallback for every role,
fallback-chain cycle breaking, wrong-role isolation), the two acceptance tests
(every reference resolves to a file-backed asset; swapping an asset changes the
resolved output with no consumer change), a manifest-integrity test that runs
the verifier, and the public `GET /assets` API test.

### Scope note (foundational, not yet full breadth)

The framework, validation, resolver, and API are complete. The player-UI refresh
applies `<Asset>` to location banners, item icons, and the admin gallery this
phase; the world graph, combat/enemy portraits, and the remaining panels adopt
the same component in later work with no framework change. See ADR 0014.

## Phase 20 — Admin Content Studio and apply-on-publish (2026-07-18)

**Status: core complete.** Builds the administrator Content Studio on the Phase
19 platform and the mechanism that makes a published release take effect —
**apply-on-publish** — without changing the gameplay read path. Acceptance test
met: _an administrator creates a new item, location, route, shop, encounter, and
quest in a draft release; previews them; publishes the release atomically; and
all content becomes available with no code deployment._

### Delivered

- **apply-on-publish engine** (`domain/content/content-apply.ts`): an idempotent
  applier per content type upserts definitions into the live gameplay tables by
  stable key, resolving references in dependency order. Upsert-only — never
  deletes a live row, so historical records keep resolving.
- **Content authoring service** (`domain/admin/admin-content.ts`): create a
  draft (cloned from live content or a prior release), read/edit/remove draft
  definitions with domain-specific structural validation, validate, diff against
  the published baseline, "where used", and preview a definition with its
  references resolved.
- **Atomic publication**: one transaction re-validates the whole bundle, applies
  it to the live tables, flips `DRAFT → PUBLISHED` (conditional compare-and-set),
  and writes an append-only audit row — all committing together. A publish
  carries a mandatory reason, expected version (optimistic), idempotency key, and
  requires recent re-authentication. Retirement (`PUBLISHED → RETIRED`, audited,
  definitions preserved) and roll-forward rollback are also provided.
- **Content Studio UI** (admin): releases list with status/version, "new draft
  from live", a per-release workspace with a searchable definition catalog,
  a definition editor (domain-validated on save), a validation panel
  (errors/warnings), a diff view (added/changed/removed), and the
  publish/retire workflow with mandatory reason.

### Endpoints (additive)

`/admin/content/releases` (GET list, POST create draft); per release: `GET :id`,
`GET :id/validate`, `GET :id/diff`; per definition:
`GET|PUT|DELETE :id/definitions/:type/:key`, `.../where-used`, `.../preview`;
lifecycle (reauth): `POST :id/publish`, `POST :id/retire`,
`POST /admin/content/rollback`. OpenAPI baseline regenerated (additive).

### Tests

10 new (1 file): the six-type acceptance test (author → validate → preview →
diff → publish → assert live rows), plus publication safety (reauth required,
stale-version 409, validation blocks publish and applies nothing, idempotent
replay, retire preserves definitions, editing a published release is rejected)
and authoring validation/authorization (invalid payload 422, slug/key mismatch
422, non-admin 403).

### Scope note (foundational, not yet full breadth)

The definition editor is JSON with domain-specific server validation rather than
bespoke per-type forms; a graphical world editor and preview-as-a-player at full
fidelity are layered on the same API in later work. All safety-critical behavior
(validation, atomic apply-on-publish, audit, immutability, reauth) is complete
and tested. See ADR 0013.

## Phase 19 — Versioned Game Content and Publishing Lifecycle (2026-07-18)

**Status: complete.** A content platform only — **no gameplay or API behavior
change**. The engine keeps reading the live definition tables; a versioned,
checksummed content registry is added alongside them. Acceptance test met:
_"import all current content as Release 1 with no observable gameplay or API
behavior change."_

### Delivered

- **Content registry** (`prisma`): two additive tables — `ContentRelease`
  (version, `DRAFT`/`VALIDATING`/`PUBLISHED`/`RETIRED` status, title, notes,
  timestamps) and `ContentDefinition` (release, content type, stable key,
  revision, canonical JSON payload, SHA-256 checksum), with a
  `BEFORE UPDATE OR DELETE` trigger that rejects mutating a **published**
  release's definitions. Gameplay tables are untouched.
- **Deterministic export** (`domain/content`): a `ContentTypeSpec` registry for
  all 14 content types (items, locations, routes, features, price modifiers,
  shops, gathering, recipes, enemies, encounters, quests, collections, classes,
  level progression). Each spec reads its live table into stable-key-addressed
  payloads; a canonicalizer (sorted keys, ordered arrays, `BigInt`→string,
  `undefined` dropped) makes two exports of unchanged content byte-identical.
- **Dependency graph**: every stable-key reference a definition declares becomes
  a graph edge (route endpoints, recipe inputs/output, shop pool, enemy drops,
  quest objectives, collection entries), powering referential validation, world
  connectivity, and "where used".
- **Publication validation**: `validateBundle` rejects (as publication-blocking
  errors) duplicate or changed stable keys, structurally invalid revisions,
  routes to unpublished locations, disconnected world subgraphs (unless
  `isolated: true`), unresolved recipe/reward/drop/quest/collection references,
  invalid reward/drop weights and quantity ranges, impossible shop restock pools,
  guaranteed sellback-above-markup arbitrage loops, non-collectible collection
  entries, unknown quest objective types, and missing graphical asset keys.
- **Lifecycle service**: export, validate, import-draft, atomic conditional
  publish (`DRAFT → PUBLISHED`, 409 on a non-draft), retire
  (`PUBLISHED → RETIRED`, definitions never destroyed), list releases, get
  release bundle, and an idempotent `ensureRelease1` that snapshots the current
  seeded content as a published Release 1.
- **CLI + CI gate**: `content:export`, `content:validate`, `content:release1`,
  `content:import`; CI runs `content:validate` against the seeded content on
  every build, so content that cannot legally publish fails the pipeline.

### Endpoints (additive)

None. Phase 19 is CLI- and platform-only; no HTTP surface is added, so the
OpenAPI baseline is unchanged. The Content Studio UI is Phase 20.

### Commands

| Command                    | Purpose                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `npm run content:export`   | Deterministic JSON bundle of the live content (stdout/file)  |
| `npm run content:validate` | Validate the live content against all publication rules      |
| `npm run content:release1` | Idempotently snapshot current content as published Release 1 |
| `npm run content:import`   | Import a bundle file as a validated `DRAFT` release          |

### Tests

29 new (2 files): canonicalization determinism and BigInt handling; dependency
graph edges, "where used", and undirected connectivity; every validation
rejection rule; export determinism (checksum stability) and self-validation;
the Release 1 acceptance test (published, full definition count, gameplay tables
unchanged, checksum round-trip); idempotent bootstrap; draft→publish→retire
transitions with monotonic versions and 409 guards; and database-level
published-immutability (UPDATE/DELETE blocked, drafts editable).

### Architectural rule honored

Production definition tables were **not** turned into unrestricted admin CRUD.
Published content is immutable and versioned; administrators create drafts and
publish new revisions. Retirement replaces deletion, so historical records
(inventories, transactions, combats, marketplace, quests) never dangle. See
ADR 0012.

## Phase 18 — Production Hardening, Release Validation, and Operations (2026-07-18)

**Status: complete.** Infrastructure only — no new gameplay, economy, social,
or admin capability. Closes evidenced production gaps.

### Delivered

- **Security hardening**: a security-headers plugin (CSP `default-src 'none'`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Cross-Origin-Resource-Policy`, HSTS only when `ENABLE_HSTS=true`); explicit
  Fastify `trustProxy` from `TRUST_PROXY` so `request.ip` (rate limiting) and
  secure-cookie detection are correct behind a proxy; a 256 KB body limit;
  production error redaction preserved.
- **Health, readiness, shutdown**: liveness (`/api/v1/health/live`, never
  touches the DB), readiness (`/api/v1/health/ready`, DB + migration state,
  503 when not ready), and the legacy `/api/v1/health` kept backward-compatible;
  `BUILD_VERSION` in diagnostics; an optional non-public worker health probe
  (`WORKER_HEALTH_PORT`) reporting liveness + recent pg-boss polling; graceful
  shutdown for API and worker with a 15s forced-exit deadline.
- **Observability export**: a token-guarded (`METRICS_TOKEN`) OpenMetrics
  endpoint (`GET /api/v1/metrics`) exposing the fixed-name process counters with
  no user-supplied labels; disabled (404) when the token is unset. Economy truth
  stays in the admin database-derived endpoints.
- **Data-lifecycle cleanup** (`lib/cleanup.ts`): batched, idempotent removal of
  expired/revoked sessions and old READ notifications, plus a new worker job;
  a code-enforced deletable-table allowlist (`Session`, `Notification`,
  `ChatMessage`) so audit/economic evidence is never touched.
- **Migration, integrity, backup/restore**: a clean-database migration +
  seed-idempotency test; a read-only integrity-check script (ledger chain,
  non-negative balances/stock, single active travel/combat, sale↔listing
  linkage, unique notification dedupe, chat report evidence, one account per
  character) with a zero-violations test; `pg_dump`/`pg_restore` scripts with a
  restore round-trip smoke test into a fresh database.
- **Supply chain & CI**: `npm run audit:prod` (high/critical gate, 0
  vulnerabilities), `npm run sbom` (CycloneDX), an API-baseline freeze check
  (`verify:baseline`), and CI updated with least-privilege permissions plus the
  new audit/SBOM/baseline steps.
- **Operations docs**: deployment guide, environment reference, threat model +
  security checklist, retention policy, monitoring/alerts + incident runbooks,
  backup/restore + rollback runbook, and a go/no-go release report (`RELEASE.md`).

### Endpoints (additive)

`GET /api/v1/health/live`, `GET /api/v1/health/ready`, `GET /api/v1/metrics`
(hidden from the contract, token-guarded). OpenAPI baseline regenerated
(additive: the two health paths).

### Tests

19 new (34 files, 324 tests total): security headers + HSTS toggle, liveness
vs readiness (incl. DB-down), body limit, metrics endpoint (disabled/401/200,
no labels), `parseTrustProxy` + Phase 18 env defaults, data-lifecycle cleanup
(allowlist, batched, unread-kept, idempotent), integrity checks zero-violations,
clean-DB migration + double-seed idempotency, and backup→restore→integrity→seed
round trip.

### Known limitations

Environment-dependent release conditions are documented in `docs/RELEASE.md` and
NOT executed in this validation run: container image build + non-root runtime,
a real two-node deployment behind a load balancer, and a production-volume load
smoke. Per the release rule (unknown = NO-GO), the candidate is **NO-GO
(conditional)** until those are executed and recorded; the code and all
automated gates are green. GitHub Action SHA-pinning and production secret-store
wiring are likewise operational follow-ups noted in the threat model.

## Phase 17 — Administration, Moderation, and Auditable Economy Operations (2026-07-18)

**Status: complete.**

### Delivered

- **No default administrator** (ADR 0010): `npm run admin:promote -- <email-or-name>`
  elevates an existing account, revokes its sessions, records a SYSTEM
  bootstrap audit row, is idempotent, refuses ambiguous (case-insensitive)
  targets, and in production requires `ADMIN_BOOTSTRAP_ENABLED=true`. No admin
  credential exists in source, seed, images, or startup.
- **Recent-auth, not a second token**: `POST /admin/reauth` verifies the
  current password (rate-limited, generic failure) and stamps
  `Session.adminReauthenticatedAt` on the current session only. A configurable
  window (default 10 min) gates every admin mutation and every high-sensitivity
  player-detail read; a password/role change clears it. Authorization is
  enforced by the API on every request; the frontend guard and hidden nav are
  convenience only.
- **Append-only audit** (ADR 0010): `AdminAuditLog` is a distinct authoritative
  business-audit domain — never a replacement for the technical mutation log or
  the currency/transfer/destruction/sale/report ledgers. Every successful admin
  mutation writes one row in the **same transaction** as the domain change,
  unique per `(actor, actionNamespace, idempotencyKey)` (which doubles as the
  idempotency guard). A PostgreSQL trigger rejects UPDATE/DELETE; a database
  test proves it. before/after JSON is a secret-free allowlist.
- **Bounded investigation reads**: cursor-paginated character search (masked
  emails) and per-character overview, inventory, ledger, item transfers,
  marketplace activity, and progress — paginated and date-bounded, with detail
  reads gated by recent-auth.
- **Safe economy operations**, all domain-service-backed, idempotent, and
  audited: signed Gold adjustments through the immutable ledger (debits cannot
  go negative); item grants (capacity-aware) and removals (rejecting every
  locked state — equipped, listed, in-transit, destroyed — with no force path,
  recording an ItemDestruction); `configVersion` optimistic-concurrency PATCH
  of allowlisted item-definition and shop fields (structural fields never
  mutable; stale writes 409); and an immediate restock request that runs
  through the normal locked, secure-RNG restock service (ADR 0011).
- **Database-derived economy metrics**: current total Gold, ledger
  sources/sinks, marketplace gross/tax/shipping/volume, NPC spending, items
  generated/destroyed, active listings, and a documented median unit price —
  exact BigInt arithmetic, bounded ≤90-day UTC windows, clearly separated from
  resettable process telemetry. Defined in `docs/economy-metrics.md`.
- **Chat moderation** (ADR 0011): report triage (reporter identity never
  exposed, even to admins), redaction to a fixed tombstone (row/author/channel/
  ordering and report evidence preserved; never a hard delete), immediate
  restrictions and revocation through the Phase 16 send path, and report
  resolution — each writing both an AdminAuditLog row and a
  `ChatModerationAction` record. Runbook in `docs/moderation-runbook.md`.
- **Frontend**: an Admin nav entry and workspace (ADMIN only) with a recent-auth
  panel, player lookup/inspection, Gold and item actions, database-derived
  economy metrics separated from telemetry, and a moderation queue rendering
  evidence strictly as text with redact/restrict/resolve actions.

### Database

Migration `admin_moderation_audit`: `AdminAuditLog` (append-only trigger,
unique actor+namespace+key, actor/target/action/time indexes),
`ChatModerationAction`, `Session.adminReauthenticatedAt`, `configVersion` on
`ItemDefinition` and `NpcShop`, redaction columns on `ChatMessage`, resolution
columns and expanded status enum on `ChatReport`.

### Endpoints (all under `/api/v1/admin`, additive)

`GET session`; `POST reauth`; `GET characters`, `.../overview`, `/inventory`,
`/currency-transactions`, `/item-transfers`, `/marketplace-activity`,
`/progress`; `POST .../gold-adjustments`, `/item-grants`, `/item-removals`;
`PATCH item-definitions/:slug`, `npc-shops/:id/config`; `POST npc-shops/:id/restock`;
`GET metrics/economy`; `GET chat/reports`, `POST chat/reports/:id/resolve`,
`chat/messages/:id/redact`, `chat/restrictions`, `chat/restrictions/:id/revoke`.
CLI: `npm run admin:promote`.

### Tests

28 new: bootstrap/promotion (no default creds, ambiguity, prod allow-flag,
session revocation, idempotency, SYSTEM audit without secrets); authz + reauth
(non-admin rejection, reauth-gated reads/mutations, generic failure, rate
limit, password-change invalidation); gold (one ledger + one audit entry,
negative-balance rejection, replay, concurrent duplicate-key race →
exactly-once); items (grant/replay, safe removal + destruction, locked-instance
rejection); config (allowlist patch, stale-version 409, concurrent single
winner, shop next-restock adoption); metrics (exact ledger-derived figures,
window bound); audit append-only DB enforcement + secret-free JSON; moderation
(report privacy, resolve-once, redaction tombstone + evidence preservation,
immediate restriction enforcement + revoke); six admin EXPLAIN plans. Playwright:
promote → reauth → inspect a player → credit Gold → non-admin cannot access.

### Known limitations

- Item-definition edits are limited to name/description/base value and shop
  edits to name/description/markup by design; deeper economic tuning surfaces
  are deferred. Production hardening, release validation, and operations are
  Phase 18.

## Phase 16 — Player Chat, Safety, and Real-Time Delivery (2026-07-17)

**Status: complete.**

### Delivered

- **Persistent chat, two channel kinds**: one seeded GLOBAL channel and one
  LOCATION channel per world location (nine total). A character always reads
  and sends GLOBAL (unless restricted) and only the channel for its
  authoritative current location; a traveling character has no location-chat
  membership. Every location read/send/subscription first runs the
  established lazy travel finalization, so starting travel revokes
  location-chat access and arrival grants only the destination.
- **PostgreSQL is authoritative; real-time is a hint** (ADR 0009). Messages
  commit before anything is broadcast. The shared Phase 15 socket now carries
  an additive `chat.message.created` invalidation (identifiers only, never
  text); clients fetch bodies over REST and poll every 10s as the complete
  fallback. Cross-instance fan-out uses PostgreSQL `LISTEN/NOTIFY` with an
  identifier-only payload and a backoff-reconnecting listener — never storage,
  never required for correctness.
- **Server-derived identity and membership**: the client never submits an
  author id, location id, timestamp, status, or read count. Bodies are
  normalized (line endings, trimmed), Unicode plain text with NUL/control
  characters rejected, bounded to 1–500 code points and 2000 UTF-8 bytes, and
  stored verbatim. Clients render strictly as text (no
  `dangerouslySetInnerHTML`, Markdown, or linkification).
- **Idempotent, rate-limited sends**: idempotent per author + key (a replay,
  including a concurrent same-key race, yields one row and one invalidation);
  token-bucket limits per account and per IP return HTTP 429 with a bounded
  `retryAfterSeconds` and `Retry-After` header. A rejected send never creates
  a row.
- **Cursor pagination**: opaque, stable `(createdAt, id)` cursors; backward
  history (newest-first) and gap-free forward polling (oldest-first); hard
  limit of 50, no offset pagination.
- **Safety controls**: forward-only read state; unilateral blocking (blocked
  authors vanish from the blocker's REST results and live invalidations,
  invisible to the blocked player, self-block rejected at the DB); one report
  per reporter + message with an immutable evidence snapshot that survives
  retention and makes the message undeletable; and `ChatRestriction` enforced
  lazily by the send service (active blocks sending but not reading/reporting;
  expired and revoked treated as inactive without a worker). No public API
  creates restrictions in this phase.
- **Hardened socket**: cookie-session + Origin validation on upgrade, capped
  inbound frames, a 15s heartbeat that terminates unresponsive sockets and
  closes revoked/expired sessions, and slow-consumer disconnection instead of
  unbounded buffering.
- **Retention**: a best-effort daily worker job deletes unreported messages
  older than `CHAT_RETENTION_DAYS` (default 90, range 7–365) in indexed
  batches; reports, restrictions, read state, and all other audit domains are
  never touched. Chat correctness never depends on the worker.
- **Frontend**: a Chat page with Global / Current Location tabs, unread
  badges, incrementally loaded history, a composer showing remaining length,
  rate-limit retry time, restriction state and accessible errors, block/report
  message actions, and a visible live-vs-polling status. The single app-wide
  socket routes both notification and chat events.

### Database

Migration `player_chat`: `ChatChannel` (kind/location CHECK, one-global partial
unique index, unique location), `ChatMessage` (unique author + idempotency key,
`(channelId, createdAt, id)` index, RESTRICT to channel/author),
`ChatChannelReadState` (composite id, copied ordering pair — no message FK),
`ChatBlock` (composite id, self-block CHECK), `ChatReport` (unique reporter +
message, immutable snapshot columns, RESTRICT to message), `ChatRestriction`
(active-lookup index). Seed extends idempotently with the nine channels.

### Endpoints

- `GET /api/v1/chat/channels`
- `GET /api/v1/chat/channels/:channelId/messages` (cursor, limit, direction)
- `POST /api/v1/chat/channels/:channelId/messages`
- `POST /api/v1/chat/channels/:channelId/read`
- `GET /api/v1/chat/blocks`, `PUT`/`DELETE /api/v1/chat/blocks/:characterId`
- `POST /api/v1/chat/messages/:messageId/reports`
- WebSocket event added additively: `chat.message.created`
  (eventId, channelId, messageId, occurredAt) on `/api/v1/notifications/ws`.

### Environment

`CHAT_RATE_LIMIT_BURST` (5), `CHAT_RATE_LIMIT_PER_MINUTE` (20),
`CHAT_RATE_LIMIT_IP_BURST` (10), `CHAT_RATE_LIMIT_IP_PER_MINUTE` (60),
`CHAT_RETENTION_DAYS` (90). All documented in `.env.example`.

### Tests

53 new across five files. Unit (no DB): body normalization/validation
boundaries (Unicode, control chars, code-point vs byte limits), opaque cursor
round-trip, and the account/IP token-bucket limiter on a deterministic clock.
Live-hub: targeted delivery, slow-consumer disconnect, session-revocation
close, and heartbeat termination. API (real PostgreSQL): seed + all four
constraint classes, global/location send-read, wrong-location and traveling
rejection with immediate membership change on travel, body validation and
verbatim script/markup storage, deterministic cursor pagination over identical
timestamps + gap-free forward polling + bounds, idempotent replay and a
concurrent same-key race (one row), forward-only read state, blocking
(hide/idempotent/self-block/foreign), reporting (snapshot, duplicate conflict,
self-report, undeletable evidence), active/expired/revoked restrictions,
retention cleanup (batched, idempotent, evidence-preserving), and chat metrics.
Real-time: socket auth + Origin rejection, committed-then-delivered with post-
disconnect REST recovery, blocked-author suppression over the socket, and two
API instances against one database (instance-A commit invalidates an
instance-B socket; polling recovers with NOTIFY unused). Rate-limit: burst then
429 with retry-after, no bypass across channels, and no row on rejection.
Database-plan: five chat EXPLAIN checks. Playwright: a two-player flow —
global exchange (one player with WebSockets disabled, recovering purely by
polling), shared local chat, travel revoking local access, block + report, and
history surviving reload.

### Known limitations

- Direct messages, guild/party channels, presence, typing indicators, read
  receipts, attachments, reactions, and automated moderation are deliberately
  out of scope. Administrative report triage, message redaction, and
  restriction management (creation/revocation) arrive with Phase 17.

## Phase 15 — Persistent Notifications and Worker Fallback (2026-07-17)

**Status: complete.**

### Delivered

- **Stored notifications as the source of truth** (`Notification`: type,
  payload, dedupeKey, readAt, createdAt): six event types — travel
  completed, remote delivery completed, listing sold, gathering completed,
  crafting completed, quest completed. Created via a `NotificationSink`
  (mirroring the quest event sink) INSIDE the same transaction as the
  causing domain event, at the exact finalization/settlement sites in the
  travel, marketplace, gathering, crafting, and quest services.
- **Idempotent by dedupe key**: `unique(characterId, dedupeKey)` with
  `createMany(skipDuplicates)` — the same domain event key
  ("travel:<id>", "delivery:<id>", "listing-sold:<id>", …) can never
  produce a duplicate, no matter how many times worker jobs and lazy
  finalizers race over the same event.
- **WebSocket as optional enhancement only**: an authenticated
  `/api/v1/notifications/ws` socket receives tiny `{"type":"sync"}` nudges
  (best-effort, fired post-tick after creation) and clients refetch over
  REST. The frontend polls every 15 seconds regardless — losing the
  socket, or never having one, costs latency only. Gameplay and
  notifications remain fully correct with the worker and WebSockets both
  unavailable (every generation test runs worker-less over plain REST).
- **Read state**: mark-one and mark-all endpoints; foreign notifications
  are invisible and unmarkable.
- **Frontend**: a Notifications nav entry with a live unread badge (which
  also owns the app-wide socket with exponential-backoff reconnect) and a
  notification center page with mark-read/mark-all. The Vite proxy now
  forwards WebSocket upgrades.

### Database

Migration `notifications`: `Notification` with
`unique(characterId, dedupeKey)` and read/created indexes.

### Endpoints

- `GET /api/v1/notifications`
- `POST /api/v1/notifications/:id/read`, `POST /api/v1/notifications/read-all`
- `GET /api/v1/notifications/ws` (WebSocket, authenticated)

### Tests

Seven new: generation from every supported event (travel arrival with the
destination named, gathering + crafting completions, quest completion,
listing sold notifying the seller with proceeds, and a remote delivery
notifying the buyer), dedupe-key idempotency under repeated finalization
and direct double-writes, read/read-all with unread counts and foreign
404s, and a live-socket test that receives the sync nudge over a real
WebSocket then proves REST keeps working after disconnect. Playwright: a
courier walks the 30-second road, the unread badge appears (socket nudge
or poll), the center shows the stored arrival, and mark-all clears the
badge.

### Known limitations

- The live nudge may fire marginally before the creating transaction
  commits; the client's refetch plus 15s polling make this unobservable in
  practice (documented best-effort behavior).

## Phase 14 — Museum Collection and Item Destruction (2026-07-17)

**Status: complete.**

### Delivered

- **Regional Artifacts collection** at the Crownfall City Museum of
  Regional Artifacts (the MUSEUM feature seeded back in Phase 4): exactly
  the three COLLECTIBLE catalog items are eligible — Sunken Crown Fragment
  and Ancient Trade Seal (instances), and the Painted River Pebble, now a
  stackable collectible with a rare Briar Wolf drop so one artifact is
  obtainable in normal play today.
- **Atomic, irreversible donations**: one transaction under the character
  row lock removes the asset (stack quantity −1, or instance stripped of
  ownership and marked destroyed), records the ItemTransfer to the world
  and a permanent ItemDestruction row, creates the
  CharacterCollectionDonation, and emits the MUSEUM_DONATION quest event —
  committing together or not at all, so the collection and quest progress
  cannot diverge. No gameplay path reverses a donation.
- **First copy only**: `unique(characterId, collectionEntryId)` plus an
  in-transaction check — duplicate donations are rejected with the second
  copy untouched.
- **Locked-state protection**: listed, in-transit, equipped, destroyed, or
  missing assets are unreachable by the donation filter (409
  ITEM_UNAVAILABLE); donations require presence at the museum (NOT_HERE
  elsewhere); non-entry items are NOT_ELIGIBLE.
- **Curator notes**: each entry's story is revealed only after donating.
- **Frontend**: museum panel on the Crownfall City location page (progress,
  carried-copy counts, a donate flow with an explicit "Donations are
  permanent" confirmation, revealed notes) and a read-only Collection
  progress page in the nav that hides undonated artifacts behind `???`.
- The museum feature module joins `GAME_MODULES`; the API baseline was
  regenerated for the two new endpoints (pure additions).

### Database

Migration `museum_collection_destruction`: `CollectionDefinition`,
`CollectionEntry` (unique collection + item), `CharacterCollectionDonation`
(unique character + entry, forever), `ItemDestruction` (permanent record
with reference to the causing donation).

### Endpoints

- `GET /api/v1/collections`
- `POST /api/v1/collections/:id/donations`

### Tests

Nine new: seeded Regional Artifacts with exactly the three collectible
definitions and hidden curator notes, instance donation (ownership removed,
destroyed, transfer + destruction rows, note revealed), stack donation
(quantity reduced, remainder kept), duplicate rejection with the second
copy retained and single records, the full locked-state matrix (missing,
LISTED, IN_TRANSIT, equipped — nothing recorded through any rejection),
wrong-location and non-eligible rejections, quest-donation atomicity (the
museum quest flips COMPLETED_UNCLAIMED in the same call), and rejected
donations moving neither collection nor quest. Playwright: a patron
accepts the museum quest, donates the crown fragment through the
confirmation flow, sees it on display with its curator note, checks the
collection page, claims the quest reward, and finds the artifact gone from
the pack.

### Known limitations

- Only the Painted River Pebble drops in normal play today; the other two
  artifacts await future acquisition sources (later-phase content).

## Phase 13B — Architecture Hardening, Quality Gates, Observability (2026-07-17)

**Status: complete.** No gameplay changes; no migrations; no endpoint
changes. Existing saves and the existing API remain fully compatible (and
a test gate now proves the latter).

### Delivered

- **Feature-module composition** (ADR 0008): `app.ts` shrank to
  infrastructure only; fourteen modules under `apps/api/src/modules/`
  each expose one `register(ctx)` function owning service construction,
  dependency wiring (via a progressively filled `ServiceRegistry` with
  fail-fast `requireService`), finalizer registration, and routes.
  Explicit ordered construction — deliberately no DI framework. A
  composition test asserts the module list and that every module's routes
  exist on the running app.
- **Mandatory ESLint** (flat config, type-checked): no floating promises,
  exhaustive switches, no explicit `any`, no unused imports/variables,
  inline type-only imports, deterministic import ordering, React Hooks and
  jsx-a11y rules — plus an architectural boundary rule forbidding route
  files from importing the database client or gameplay-math helpers
  (routes validate, authorize, delegate, serialize; nothing else).
  Stylistic rules stay with Prettier. `npm run lint` / `lint:fix`.
- **CI quality gates** (`.github/workflows/ci.yml`): format, lint,
  typecheck, repository structure, the full test suite against a real
  PostgreSQL service (including the new index-plan and API-compatibility
  gates), and the production build fail the pipeline on violation.
- **Structured observability**: every state-changing request logs one
  structured `authoritative mutation` entry — requestId, accountId,
  route-pattern operation, idempotency key (the only field ever lifted
  from a body), duration, status, success. Secrets/passwords/tokens never
  reach audit entries; pino redaction stays in place.
- **Domain metrics** (`lib/metrics.ts`): process-local counters for
  idempotency replays, unique-constraint concurrency conflicts, stale
  combat commands, marketplace purchase conflicts, quest claim retries,
  worker failures, lazy finalizer executions, transaction retries, and
  deadlocks — wired at the exact conflict/replay sites. Fixed name set,
  no high-cardinality labels, operational only.
- **Concurrency test helpers** (`test-concurrency.ts`): `raceRequests`,
  `expectSingleWinner`, `replayRequest`, `expectIdempotentReplay`,
  `raceFinalizers` — existing race tests refactored onto them; still real
  PostgreSQL underneath.
- **Database performance verification** (`db-performance.test.ts`):
  EXPLAIN plans captured under `enable_seqscan = off` prove
  inventory, marketplace, combat, quest, and notification-preparation
  queries have usable index paths (accepting equivalent unique/partial
  indexes); no timing assertions.
- **API compatibility gate**: the generated OpenAPI document (still
  documentation only — shared Zod schemas remain the contract) is
  snapshotted to `apps/api/api-baseline.json`; tests fail on removed
  endpoints, removed properties, changed enums, or required fields
  becoming optional, and mutation tests prove the comparator catches each
  class. Regenerate intentionally with `npm run api:baseline`.
- **Documentation**: `docs/architecture.md` (boundaries, transaction
  rules, event flow, idempotency conventions, locking strategy, module
  system, where new gameplay belongs) and ADR 0008.
- **Flaky-test fix while proving "existing gameplay unchanged"**: combat
  "killing blow" tests could miss (~5% accuracy roll) — victory paths now
  swing until decided, preserving all exactly-once assertions.

### Tests

19 new: composition (module list, per-module routes, fail-fast ordering),
observability (structured fields present, secrets absent, reads skipped),
metrics (counting, snapshots, finalizer counter), concurrency helper
self-tests (winner/replay/parallelism semantics), nine index-plan checks,
and four API-compatibility checks including intentional-change detection.
All 204 Vitest tests and 12 Playwright specs pass; lint, typecheck, and
builds are clean.

### Known limitations

- The Prisma schema stays single-file (multi-file schema support was
  judged not worth the churn); domain sections are clearly delimited.
- Metrics are in-process counters without an export endpoint; the Phase 16
  admin surface is the natural place to expose them.

## Phase 13 — Quests and Transactional Domain Events (2026-07-17)

**Status: complete.**

### Delivered

- **Five seeded typed quests** — Errand to the Market (travel), Copper for
  the Forges (mining), Prove Your Metal (crafting), Thin the Hollow
  (combat), and A Gift for the Museum (collection — acceptable now,
  completable once Phase 14 donations exist). Rewards: XP, Gold, and items,
  validated at seed time against real locations, items, recipes, and
  enemies.
- **Typed in-process domain events** (`QuestDomainEvent` +
  `QuestEventSink`), deliberately not an event bus: the travel finalizer,
  gathering/crafting grant paths, and combat victory settlement call the
  sink synchronously inside the SAME transaction as their verified action,
  so quest progress commits (or rolls back) atomically with the action.
  Travel emits arrival + destination; gathering emits granted reward
  quantities; crafting emits the completed recipe; combat emits every
  defeated enemy slug.
- **Progress only after acceptance**: accepting creates the CharacterQuest
  (ACTIVE) with zeroed QuestProgress rows; prior actions are never counted
  retroactively. Counts cap at the objective requirement, and completion
  flips to COMPLETED_UNCLAIMED via a conditional update exactly once.
- **The frontend never submits progress** — no progress endpoint exists at
  all; the only writes are accept and claim.
- **Manual claim, exactly once**: the claim transaction takes the character
  lock, conditionally flips COMPLETED_UNCLAIMED → CLAIMED, then grants XP
  (level-ups apply), Gold through the ledger (QUEST_REWARD, idempotent per
  character-quest), and reward items. An inventory-capacity failure rolls
  the whole transaction back — the quest stays COMPLETED_UNCLAIMED with
  nothing granted, claimable again after space frees.
- **Frontend**: a Quests page (new nav entry) with status chips, objective
  progress bars, reward summaries, and accept/claim actions.

### Database

Migration `quests_domain_events`: `QuestDefinition`, `QuestObjective`
(typed, slug-targeted, unique quest + sortOrder), `CharacterQuest`
(ACCEPTED/ACTIVE/COMPLETED_UNCLAIMED/CLAIMED, unique character + quest),
`QuestProgress` (unique characterQuest + objective).

### Endpoints

- `GET /api/v1/quests`
- `POST /api/v1/quests/:id/accept`, `POST /api/v1/quests/:id/claim`

### Tests

Five quest definitions with valid objective/reward data (one of each
objective type), progress gating (actions before acceptance never count;
after acceptance granted quantities accumulate and cap), double-acceptance
rejection, forged progress rejected (no route exists; early claims 409
with nothing moved), event-driven updates end to end for travel arrival,
two crafting completions, and combat victories counting each defeated
enemy, the museum quest acceptable but inert pre-Phase 14, claim exactly
once (XP + single ledger credit, ALREADY_CLAIMED on repeat with nothing
re-granted), and the capacity-blocked claim cycle (rollback keeps
COMPLETED_UNCLAIMED with zero grants, then a clean exactly-once claim
after freeing space). Playwright: a courier accepts the market errand,
walks the 30-second road, watches the quest complete on arrival, claims
30 XP + 15 Gold once, and sees the XP on the character sheet.

### Known limitations

- The DONATE_ITEM objective waits on Phase 14's museum donations; the
  ACCEPTED enum state is reserved (acceptance currently activates
  directly).

## Phase 12 — Classic Initiative-Gauge Combat (2026-07-17)

**Status: complete.**

### Delivered

- **Server-authoritative persisted combat** at Blackwood Forest (Slime
  Hollow, Briar Wolf Pack, The Ironhide Boar elite), North Road (Roadside
  Ambush), and Ironroot Mine (Beetle Warren, Ember Roost, and the Warden of
  the Hollow Forge boss — instanced, unfleeable, gated on level 5 plus a
  recorded Ironhide Boar victory). Seven seeded enemies with element
  affinities, weighted AI, and reward tables. No permanent tick loop: state
  advances only through the locked, versioned command endpoint.
- **Initiative gauge (0–100 fixed-point)**: rate `max(1, agility)` scaled
  by Haste/Slow; the next ready combatant comes from advancing all gauges
  by the minimum virtual time, with ties broken by higher Agility, then
  higher Luck, then stable slot. The player always pauses at a full gauge
  for a command; enemy actions use weighted AI (silenced casters fall back
  to attacks).
- **Damage**: fixed-point integer formulas from configuration —
  physical (Strength × power + base − Defense mitigation), magical (Magic ×
  spell power − Magic Defense mitigation), secure 90–110% variance from the
  combat PRNG, elemental multipliers (weak 1.5 / neutral 1.0 / resistant
  0.5 / immune 0 in bps), Guard reduction, and a back-row melee penalty
  unless the attack is ranged (ember bats shoot from the back row; Quick
  Shot reaches it at full force).
- **Statuses with exact timing**: Poison ticks after the affected
  combatant completes any action (stun skips included); Blind reduces
  physical accuracy; Silence blocks Magic; Slow/Haste change the initiative
  rate; Guard (Defend) activates immediately and expires when the
  defender's next command phase begins; Stun at full gauge skips the
  action, resets to 0, consumes one charge, and still processes post-action
  ticks; Armor Break lowers effective Defense.
- **Commands** (Attack, Ability, Magic, Item, Defend, Flee) carry an
  idempotency key and expected combat version: the combat row is locked,
  stale versions and replays are rejected without resolving, and every
  resolved command increments the version. Class books: Vanguard Heavy
  Strike / Shield Guard / Break Armor; Wayfarer Quick Shot / Twin Cut /
  Smoke Step; Arcanist Flame Spark / Frost Shard / Storm Pulse (all
  data-driven configuration).
- **Deterministic server-secret PRNG**: HMAC-SHA256(seed, counter) with the
  counter persisted per combat — a refresh replays nothing and rerolls
  nothing; the seed never appears in any API response.
- **Flee**: Agility difference, encounter modifier, and a failed-attempt
  bonus, clamped to configured bounds; failed attempts consume the action;
  the boss is unfleeable.
- **Items in combat**: ownership and combat usability validated; the stack
  decrements inside the same successful command transaction — stale or
  failed commands consume nothing.
- **Victory (exactly once)**: one transaction flips the combat, creates the
  unique CombatRewardGrant marker, grants XP (multi-level-ups apply), Gold
  through the ledger, and capacity-aware drops (anything that cannot fit is
  recorded as left behind, never duplicated). **Defeat (exactly once)**:
  return to Crownfall City, 40% HP/MP restore rounded up, and a level-based
  recovery fee capped and clamped so Gold never goes negative.
- **Frontend**: encounter lists on combat locations (kind badges, rosters,
  lock reasons, mid-battle return link) and a combat screen with HP/MP/
  gauge bars, status chips, command menus with target selection, usable
  items, rewards, and a readable battle log at `/combat/:id`.

### Database

Migration `combat_initiative_gauge`: `EnemyDefinition`,
`EncounterDefinition`, `Combat` (version, server-secret rngSeed +
rngCounter, log, unique character + idempotency key, partial unique index
for one ACTIVE combat per character), `CombatantState` (snapshot stats,
fixed-point gauge, unique combat + slot), `CombatStatusEffect`,
`CombatRewardGrant` (unique per combat).

### Endpoints

- `GET /api/v1/combat/encounters`, `POST /api/v1/combat/start`
- `GET /api/v1/combat/:id`, `POST /api/v1/combat/:id/commands`

### Tests

Engine (pure, no DB): initiative advancement and every tie-break rule,
Haste/Slow rates, physical/magical formulas with variance bounds, all four
elemental multipliers including immunity, back-row melee reduction vs
ranged and magic, Blind accuracy, Armor Break, Guard reduction and
expiry-at-next-command, Poison timing (after actions and stun skips), Stun
semantics, Silence blocking Magic with nothing consumed, flee formula
(clamping, retry bonus, consumption, unfleeable), multi-hit and
all-enemies abilities, MP gating, victory/defeat outcomes, and PRNG
determinism for a persisted (seed, counter). API: encounter listing, boss
gating (level and prior-victory requirements enforced end to end),
wrong-location and conflicting-combat rejections, idempotent starts,
refresh persistence with identical reads and zero PRNG leakage, stale
version/replay rejection with no state advance, combat item atomicity
(exactly-once decrement, non-usable rejection, stale replays consume
nothing), victory settlement exactly once (XP, single ledger credit,
unique grant marker, no duplication after COMBAT_OVER), and defeat
settlement (home to Crownfall, 40% restore rounded up, fee clamped to the
balance). Playwright: a Vanguard fights the Slime Hollow — encounter list,
persisted mid-fight refresh, target selection, victory rewards, and the XP
on the character page.

### Known limitations

- Quest events from combat are deliberately not emitted yet (Phase 13).
- Resting at an inn does not interact with an in-progress combat's
  snapshotted HP; combat state is authoritative until the battle ends.

## Phase 11 — Blacksmithing and Timed Crafting (2026-07-17)

**Status: complete.**

### Delivered

- **Blacksmithing only, at the Crownfall Forge** (Market District CRAFTING
  feature): three seeded deterministic recipes — Smelt Copper Ingot (level 1,
  3 copper ore + 1 forge coal + 2 Gold, 12s, 10 XP), Smelt Iron Ingot
  (level 2, 3 iron ore + 1 forge coal + 4 Gold, 20s, 14 XP), Forge Bronze
  Longblade (level 3, 2 copper ingots + 1 iron ingot + 2 forge coal +
  25 Gold, 40s, 30 XP → an equipment instance). No RNG and no failure
  chance in this release; the economy loop closes: mine ore at Ironroot,
  buy coal at the general goods shop, smelt and forge at the anvils.
- **Consume once**: inputs (`removeFromStack`) and the Gold fee
  (CRAFTING_FEE ledger debit) are consumed atomically inside the
  run-creation transaction under the character row lock. Replays with the
  same idempotency key return the original run without consuming again;
  concurrent starts leave exactly one run, one consumption, one ledger
  entry. A failed debit rolls back the input removal (nothing partial).
  Goods held on marketplace listings are unreachable by construction —
  listed stack quantities were already moved off the active stack.
- **Complete once**: the crafting finalizer (registered with the shared
  timed-state runner, domain-specific finalization) flips status
  conditionally then grants the snapshotted output + profession XP in one
  transaction — exactly-once under concurrent requests, no duplication
  across refreshes or start retries. The pending output is snapshotted at
  start so completion grants exactly what was promised. Stackable outputs
  join stacks; the Bronze Longblade arrives as an owned, unlocked instance.
- **Capacity-held outputs**: a full pack at completion parks the run as
  OUTPUT_HELD with the pending output untouched — claimable exactly once
  via `claim` after freeing space, never rerolled or discarded; held work
  blocks new runs until collected.
- **Blacksmithing profession**: per-character XP in
  `CraftingProfessionProgress`; level derived from a shared monotonic
  progression (cap 10) gating the deeper recipes.
- **Guards**: wrong location (NOT_HERE), insufficient inputs
  (INSUFFICIENT_ITEMS, nothing consumed), insufficient Gold
  (INSUFFICIENT_GOLD, inputs restored by rollback), conflicting run
  (partial unique index + in-transaction re-check), profession too low.
- **Frontend**: forge panel on the Market District location page — recipe
  cards with input requirements against the pack ("have N"), Gold cost and
  duration, live progress bar, held-output collection, and completion
  notice with output and XP.

### Database

Migration `crafting_blacksmithing`: `CraftingProfessionProgress` (unique
character + profession), `CraftingRecipe` (seeded, Zod-validated JSON
inputs, output item + quantity), `CraftingRun` (pending-output snapshot,
status IN_PROGRESS/OUTPUT_HELD/COMPLETED, unique character + idempotency
key, and a partial unique index allowing at most one unfinished run per
character).

### Endpoints

- `GET /api/v1/crafting/recipes`, `GET /api/v1/crafting/status`
- `POST /api/v1/crafting/start`, `POST /api/v1/crafting/claim`

### Tests

Blacksmithing progression (monotonic, capped, boundary XP), three seeded
recipes validated over real items (blade chain outputs non-stackable
equipment), unlock reporting and SKILL_TOO_LOW, atomic consume-once
(replays and a concurrent two-key race: one run, one consumption, one
ledger entry), insufficient inputs/Gold with full rollback, wrong-location
and conflicting-run rejections, listed-goods unreachability, exactly-once
lazy completion (single output grant, single transfer, single XP award)
with no duplication across refreshes or retries, instance output for the
longblade, and the full capacity-hold cycle (hold → blocked claim →
blocked new run → freed capacity → exact grant once → second claim
rejected). Playwright: a smith at the Market District forge smelts a
copper ingot — recipe list with lock states and "have N" requirements,
progress bar surviving refresh with nothing granted, then the revealed
ingot, Blacksmithing XP, and the ingot in inventory.

### Known limitations

- Blacksmithing is the only profession; more arrive with later phases.
  Quest events for crafting are deliberately not emitted yet (Phase 13).

## Phase 10 — Mining and Timed Gathering (2026-07-17)

**Status: complete.**

### Delivered

- **Mining at Ironroot Mine only**, offered through the Mining Galleries
  GATHERING feature: three data-driven actions — Mine Copper Seam (level 1,
  2 stamina, 12s, 8 XP), Mine Iron Vein (level 2, 3 stamina, 20s, 12 XP),
  Search Crystal Pocket (level 4, 4 stamina, 30s, 18 XP) — each with its own
  weighted reward table over seeded ores (copper/iron/glimmer crystal).
- **Unrevealed stored outcomes**: the authoritative reward is rolled once at
  start with secure server RNG (one weighted table entry + quantity range)
  and stored server-privately on the run. Pending responses (`start`,
  `status`) carry no reward information whatsoever; refreshing can never
  reroll it. The reveal happens only after the timestamp passes.
- **Replay-safe completion** via the shared timed-state utility: the
  gathering finalizer is registered with the runner, so any
  location-dependent request (or `status`/`claim`) lazily finalizes an
  expired run — conditional status flip first, then the grant, in one
  transaction under the character row lock, making rewards and skill XP
  exactly-once even under concurrent requests. Works with the worker
  stopped; the timestamp is the authority.
- **Capacity-held rewards**: if inventory has no room at completion, the run
  parks as REWARD_HELD with its outcome untouched — never rerolled or
  discarded. `claim` grants it exactly once after space is freed (a claim
  while still full is rejected and changes nothing); held rewards block new
  runs until claimed.
- **Mining skill**: per-character XP in `CharacterSkill`; level derived from
  a shared strictly monotonic progression (cap 10) so API and frontend agree.
  Higher levels unlock the deeper actions.
- **Guards**: wrong location (NOT_HERE), insufficient stamina (charged
  exactly once at start, atomically with run creation), active conflicting
  run (partial unique index + in-transaction re-check), stale replays
  (idempotency key returns the original run without recharging), skill too
  low.
- **Frontend**: mining panel on the Ironroot Mine location page — skill
  progress, action list with lock states, live progress bar, held-reward
  claim flow, and a result reveal that only appears once the server reveals
  the outcome.

### Database

Migration `gathering_mining_skills`: `CharacterSkill` (unique character +
skill), `GatheringActionDefinition` (seeded, Zod-validated reward tables),
`GatheringRun` (server-private `outcome` JSON, status
IN_PROGRESS/REWARD_HELD/COMPLETED, unique character + idempotency key, and a
partial unique index allowing at most one unfinished run per character).

### Endpoints

- `GET /api/v1/gathering/actions`, `GET /api/v1/gathering/status`
- `POST /api/v1/gathering/start`, `POST /api/v1/gathering/claim`

### Tests

Mining level progression (monotonic, capped, boundary XP values), unlock
reporting and SKILL_TOO_LOW, three seeded reward tables validated against
real stackable items (distinct weighted tables), stored-outcome-equals-grant,
stamina charged exactly once (including idempotent replay and a concurrent
two-key race with one winner), insufficient stamina creates no run,
wrong-location and conflicting-run rejections, pending responses leak no
reward fields, no reroll across refreshes, exactly-once concurrent
finalization (single stack grant, single transfer, single XP award),
worker-stopped determinism, and the full capacity-hold cycle (hold → blocked
claim → blocked new run → freed capacity → exact grant once → second claim
rejected). Playwright: a miner at Ironroot Mine starts a copper seam run,
sees a progress bar with no reward text before and after a refresh, then the
revealed haul, Mining XP progress, and the ore in inventory.

### Known limitations

- Mining is the only gathering skill; other skills and locations arrive with
  their own phases. Quest events for gathering are deliberately not emitted
  yet (Phase 13).

## Phase 9 — Player Shops, Listings, Marketplace, Regional Delivery (2026-07-16)

**Status: complete.**

### Delivered

- **PlayerShop**: one per character (unique constraint), registered to a
  region (crownfall / northmarch / deepvale — validated against the seeded
  map), name/description editable via PATCH.
- **Whole-listing fixed-price commerce**: listings hold either stack goods
  (quantity moved off the stack onto the listing, transfer reason
  LISTING_HOLD) or a single instance (lockState LISTED, still seller-owned).
  Creation requires a marketplace-enabled location (initially only the
  Market District), charges the listing fee (2% bps, min 1) through the
  ledger, and creates a capacity reservation guaranteeing safe return.
  Price bounds: minimum 1 Gold; configurable maximum validated below
  `Number.MAX_SAFE_INTEGER`.
- **Expiry semantics**: expired listings are unavailable the moment
  `expiresAt` passes — purchase returns 409 before any cleanup. Lazy
  finalization (return goods + release reservation, exactly once via a
  conditional status flip) runs on marketplace views, inventory views, the
  seller's location-dependent requests (timed-state finalizer), cancel, and
  a periodic pg-boss worker sweep (every 5 minutes; never the authority).
- **Purchases** (marketplace location only, one transaction, listing row
  lock, idempotent per buyer + key): buyer pays price (+ flat shipping when
  remote), seller is credited `gross − floor(gross × 500bps / 10000)`; tax
  and shipping are sinks. Self-purchase rejected. **Local** (listing shop
  region == buyer's current region): goods placed immediately. **Remote**:
  ownership transfers to the buyer at purchase — stacks held in
  DeliveryLine, instances buyer-owned with lockState IN_TRANSIT (unequippable
  until arrival) — destination capacity reserved at purchase (rejected if
  impossible), and a timed Delivery converts the reservation into placement
  exactly once at arrival (lazy on /deliveries and /inventory, race-tested).
- **Market summary** per item: active listings, cheapest, recent sales,
  median per-unit price, and volume — "insufficient market history" below
  five comparable sales.
- **Browsing from any safe location** (409 in dangerous places); buying and
  listing only at a marketplace.
- **Frontend**: Marketplace page (shop create/edit, deliveries with
  countdown, filters, my-listings view with cancel, buy dialog with remote
  shipping notice, summary card) and "List for sale" in the inventory item
  dialog. Marketplace joins the nav.

### Database

Migration `player_shops_marketplace`: `PlayerShop`, `MarketplaceListing`
(unique seller+key, unique instance, status/expiry indexes),
`MarketplaceSale` (unique buyer+key, per-item sales index), `Delivery`
(unique per sale), `DeliveryLine`.

### Endpoints

- `POST /api/v1/player-shops`, `GET/PATCH /api/v1/player-shops/me`,
  `GET /api/v1/marketplace/regions`
- `POST/GET /api/v1/marketplace/listings`,
  `DELETE /api/v1/marketplace/listings/:id`,
  `POST /api/v1/marketplace/listings/:id/purchase`
- `GET /api/v1/marketplace/items/:slug/summary`, `GET /api/v1/deliveries`

### Tests

Shop uniqueness/region validation/PATCH, stack listing (held goods, 6-Gold
fee on 300, live reservation, idempotent replay), instance lock + re-list +
equip rejection, price bounds + wrong-location, cancel with return + released
reservation + foreign-cancel 403, immediate expiry unavailability + exactly-
once concurrent finalization, local purchase with tax rounding (999 → tax 49,
proceeds 950) + immediate goods + idempotent replay, remote purchase
(shipping 10, buyer ownership + IN_TRANSIT + unequippable, held reservation,
exactly-once concurrent arrival), capacity-reservation rejection with nothing
charged, concurrent buyers (one winner, seller credited once), self-purchase/
unsafe-browsing/non-marketplace rejections, and summary history thresholds
(insufficient <5; median 10 and volume 50 after 5 sales). Playwright: a
two-player journey — seller opens a shop, both travel to the Market
District, seller lists a draught from inventory, buyer purchases it locally,
goods arrive instantly, and the seller's ledger shows +24 proceeds.

### Known limitations

- Partial purchases are out of scope by design (whole-listing only).
- Notifications for sold listings/completed deliveries arrive in Phase 15.

## Phase 8 — Regional Pricing and NPC Shop Restocks (2026-07-16)

**Status: complete.**

### Delivered

- **Regional price modifiers** (`RegionalPriceModifier`, basis points per
  location × item category) seeded for the whole map before any purchase
  logic: Market District broad demand (+5% across categories), Ironroot
  cheaper ore (−25%) and costlier food (+30%), Greenmeadow cheaper
  food/herbs and costlier metal gear, Silvermere cheaper fish, Harbor
  cheaper specialty imports. Only the Market District shops consume them
  today. Unit price = base value × location modifier × shop markup, all in
  BigInt basis points, floored, minimum 1.
- **Two shops** in the Crownfall Market District: Crownfall General Goods
  (consumables/sundries, 30-min restocks ± 10-min jitter) and Crownfall
  Forge (arms, armor, ingots, 45-min ± 15-min). Weighted restock pools with
  quantity ranges and per-restock purchase limits live in validated JSON
  config; **sellback rates are validated strictly below markup**, so a
  guaranteed buy-at-NPC/sell-to-NPC loop is impossible by construction.
- **Lazy restocking** (timestamp authority): the first view after
  `nextRestockAt` performs the restock under a shop row lock (exactly once
  under concurrent views); if downtime skipped several intervals, **at most
  one catch-up restock** runs and the next is scheduled from the current
  time plus secure-RNG jitter. Stock entries are drawn by weighted sampling
  without replacement (Node crypto, ADR 0005). Exact restock timestamps and
  exact remaining quantities never leave the API — clients see
  PLENTY/SOME/LOW/SOLD_OUT.
- **Race-safe purchases**: one transaction validates location, stock
  freshness (only the current restock is purchasable), the per-character ×
  per-entry × per-restock limit, Gold, and capacity, then debits the
  ledger, adds inventory with ItemTransfer records, decrements stock with a
  conditional update (never negative), and records the NpcShopPurchase —
  all atomic, idempotent per character + key (replays return the recorded
  purchase).
- **Frontend**: NPC_SHOP feature cards on the district page link to the shop
  page — stock list with prices, approximate-stock badges, per-restock
  limits with your purchase count, and a quantity + confirmation dialog.

### Database

Migration `npc_shops_regional_pricing`: `RegionalPriceModifier`, `NpcShop`
(markup/sellback bps, pool JSON, restock interval + jitter, next/last/current
restock), `NpcShopRestock`, `NpcShopStockEntry` (total/remaining, BIGINT unit
price, per-character limit), `NpcShopPurchase` (unique character + key).

### Endpoints

- `GET /api/v1/npc-shops`, `GET /api/v1/npc-shops/:id`
- `POST /api/v1/npc-shops/:id/purchases`

### Tests

Two seeded shop configurations (jitter, weighted pools, resale spread),
regional modifier matrix, weighted restock with quantity/price bounds and no
leaked timestamps, at-most-one catch-up after 5h downtime with rescheduling
from now, exactly-once restock under 5 concurrent views, atomic purchase
(gold + stock + inventory + ledger + transfer) with idempotent replay,
wrong-location rejection, insufficient Gold and capacity-blocked purchases
changing nothing, per-restock limit enforcement with stale-stock rejection
and reset after a forced restock, final-unit concurrency (two buyers → one
success, stock exactly zero, loser uncharged), and approximate-only stock
levels. Playwright: after the real 30-second journey, browse General Goods,
buy via the confirmation dialog, and see the item in the pack.

### Known limitations

- Selling to NPCs is not implemented (no endpoint in the initial release);
  the sellback rate exists as validated config so the spread invariant is
  enforced from day one.

## Phase 7 — Currency Ledger and Crownfall Inn (2026-07-16)

**Status: complete.**

### Delivered

- **CurrencyAccount** is now the authoritative Gold balance (1:1 with the
  character; `Character.gold` migrated in with a data migration that also
  backfilled synthetic STARTING_GRANT ledger entries). BIGINT storage,
  `BigInt` server-side, decimal strings in every API payload.
- **Immutable CurrencyTransaction ledger**: signed amount, balanceBefore,
  balanceAfter, type, related entity, operation namespace + idempotency key
  (unique per account and namespace). Every balance change happens inside
  the caller's transaction with exactly one ledger entry; the account row is
  locked (`SELECT … FOR UPDATE`) so concurrent changes serialize — verified
  by an 8-way concurrent chain-consistency test and a 5-way concurrent
  idempotency test (one applied).
- **No balance mutations outside the currency service**; negative resulting
  balances are rejected atomically (`INSUFFICIENT_GOLD`, nothing partial).
- **Integer basis-point math** (`lib/money.ts`): `floor(gross × bps / 10000)`
  in pure BigInt, ready for Phase 9 taxes; unit-tested flooring.
- **Crownfall Inn activated**: `POST /locations/current/inn/rest` requires an
  INN feature at the current (non-traveling) location, charges the
  level-scaled fee (5 + 2×level Gold) and restores HP/MP to their
  equipment-inclusive maxima in one transaction. Idempotent per key
  (replays return the stored outcome without recharging); fully rested
  characters are turned away before any Gold moves; insufficient Gold
  changes nothing.
- **Character creation** opens the account with the starting grant + ledger
  entry inside the creation transaction.
- **Frontend**: recent-ledger card on the character page (signed amounts,
  running balance) and a Rest action on the Inn feature card (only rendered
  where an INN exists — i.e. Crownfall City).

### Database

Migration `currency_ledger`: `CurrencyAccount` (unique characterId, BIGINT
balance), `CurrencyTransaction` (unique account+namespace+key, indexed by
account+createdAt), custom SQL backfill from `Character.gold`, then column
drop.

### Endpoints

- `GET /api/v1/currency`, `GET /api/v1/currency/transactions`
- `POST /api/v1/locations/current/inn/rest`

### Tests

Starting grant + single entry + precision through the character response,
credit/debit with per-change entries (14-digit BIGINT amounts),
negative-balance rejection with untouched ledger, concurrent idempotency
(5× same key → 1 applied; same key different namespace applies), concurrent
ledger chain consistency (after = before + amount, sum = balance),
basis-point flooring, inn wrong-location rejection, atomic restore + debit +
exactly-once per key + ALREADY_RESTED + insufficient-Gold no-op + blocked
while traveling. Playwright: starting grant in the ledger UI, inn card only
in Crownfall City, fully-rested rejection with unchanged balance.

### Known limitations

- Gold sources beyond the starting grant arrive with combat (Phase 12) and
  marketplace sales (Phase 9); sinks beyond the inn arrive with shops
  (Phase 8).

## Phase 6 — Item Definitions, Inventory, Capacity, Transfers, Equipment (2026-07-16)

**Status: complete.**

### Delivered

- **Dual inventory model**: `InventoryStack` (unique per character + item)
  for identical stackable commodities; `ItemInstance` for equipment and
  uniquely stateful items with individual ownership.
- **Slot capacity** (24 per character, `config/game.ts`): each stack consumes
  one slot regardless of quantity, each unequipped active instance one slot,
  equipped instances none. `InventoryCapacityReservation` rows hold
  destination slots for assets that will return or arrive later and count as
  used. Capacity checks guard every grant; concurrent mutations serialize on
  a `SELECT … FOR UPDATE` character lock (raw SQL repository function,
  ADR 0003) — a 10-way concurrent removal test drains a stack to exactly
  zero, never negative.
- **ItemTransfer**: aggregate rows for stack movements (one row per movement,
  quantity N) and per-transfer rows for instances (full ownership history);
  from/to null means the world.
- **Equipment**: nine slots (main/off hand, head, body, hands, legs, feet,
  two accessories). Equip validates ownership, lock state, category, slot
  fit (accessories fit either accessory slot), and level requirement; swaps
  are capacity-neutral; unequip requires a free slot. Locked (LISTED /
  IN_TRANSIT) or destroyed assets are rejected everywhere.
- **Derived stats now include equipment bonuses** (class + level + equipped
  item definitions, computed — never stored). Equipping raises maxima
  without healing; level-up restores to the equipment-inclusive maxima.
- **25-item catalog** seeded: 5 resources, 4 consumables, 6 equipment,
  3 crafting components, 3 collectibles (museum artifacts), 2 quest items,
  2 specialty goods — with stack maxima, bonuses, restore effects, level
  requirements, and BIGINT base values.
- **Starter kit**: new characters receive 2 Lesser Healing Draughts and a
  Quilted Tunic inside the creation transaction, with transfer records.
- **Frontend**: inventory page (slot usage, search, category filters, stack
  and unique rows with lock/equipped badges, item detail dialog with equip
  action) and an equipment panel on the character page with unequip per
  slot. Inventory joins the nav.

### Database

Migration `items_inventory_equipment`: `ItemDefinition`, `InventoryStack`,
`ItemInstance` (lockState, destroyedAt), `EquipmentAssignment` (unique per
character+slot and per instance), `InventoryCapacityReservation`,
`ItemTransfer`.

### Endpoints

- `GET /api/v1/inventory`, `GET /api/v1/items/:slug`
- `POST /api/v1/equipment/equip`, `POST /api/v1/equipment/unequip`

### Tests

Catalog counts and stackable/instance coherence, item-by-slug, stack
add/merge/remove/delete with aggregate transfer records, stack maximum and
over-removal rejection, capacity accounting (stacks + instances +
reservations, equipped-is-free), capacity-blocked grants with growing
existing stacks still allowed, 10-way concurrent removal invariant,
instance ownership history, equip/unequip with swaps, wrong-slot and
level-requirement rejection, accessory slot resolution, unequip blocked at
full capacity, locked-asset rejection (LISTED and IN_TRANSIT), cross-owner
rejection, starter kit. Playwright: starter kit visible, search filter,
detail dialog, equip → slot freed + badge + 120/125 HP, unequip restores.

### Known limitations

- No consume/discard endpoints yet (combat item use arrives in Phase 12;
  destruction records in Phase 14).
- Items are only obtainable via the starter kit until shops (Phase 8) and
  mining (Phase 10).

## Phase 5 — Travel State and Shared Timed-State Utility (2026-07-16)

**Status: complete.**

### Delivered

- **Shared timed-state utility** (`apps/api/src/lib/timed-state.ts`, ADR
  0004): domains register idempotent finalizers; every location-dependent
  request runs them lazily before acting. Deliberately tiny — no workflow
  engine.
- **Server-authoritative travel**: `TravelState` rows carry origin,
  destination, route, `startedAt`, `completesAt`, status, and a start
  idempotency key. The timestamp is the authority — arrival is finalized by
  any status/location request after `completesAt`, with a conditional update
  making completion exactly-once under concurrent requests. The worker is
  never required.
- **One journey at a time**: a partial unique index
  (`TravelState_one_in_progress_per_character`, raw SQL in the migration)
  guarantees at most one IN_PROGRESS travel per character even under races;
  the API surfaces the conflict as 409 `CURRENTLY_TRAVELING`.
- **Traveling means nowhere**: `Character.currentLocationId` is null while on
  the road; `/locations/current`, features, and destinations return 409, and
  the location page shows an "on the road" notice instead.
- **Idempotent start**: repeating a start with the same idempotency key
  returns the existing travel state (unique per character + key); different
  requests while traveling conflict. Route validation only accepts direct
  neighbors; unconnected destinations are 400 `NO_ROUTE`. Travel cannot be
  canceled. Route costs remain zero (creation would charge atomically in the
  same transaction once Phase 8 activates costs; non-zero costs are rejected
  until then).
- **Frontend travel page** (`/travel`): destination list with duration/cost/
  danger notes and "Set out" buttons (idempotency key generated client-side),
  live progress bar with countdown, arrival toast, and automatic refresh of
  location-dependent data. Travel joins the nav.

### Database

Migration `travel_state`: `TravelState` with unique
(characterId, idempotencyKey), status index, and the partial unique
IN_PROGRESS index.

### Endpoints

- `POST /api/v1/travel/start`
- `GET /api/v1/travel/status`

### Tests

Start + progress reporting, unconnected-route rejection, second-travel 409,
same-key idempotency (single row), local actions blocked while traveling
(three endpoints), lazy completion via status, **plain location refresh
finalizes arrival**, exactly-once finalization under three concurrent status
requests, and chained journeys. All finalization runs with no worker
involvement. Playwright: real 30-second journey — set out, progress bar,
blocked location page, then arrival finalized by a page refresh showing the
Market District hub.

### Known limitations

- pg-boss completion notifications arrive with Phase 15; completion is
  already fully lazy and correct without them.

## Phase 4 — World Graph, Locations, and Local Feature Registry (2026-07-16)

**Status: complete.**

### Delivered

- **Eight seeded locations**: Crownfall City, Crownfall Market District,
  Crownfall Harbor, North Road, Greenmeadow Village, Ironroot Mine,
  Silvermere Lake, Blackwood Forest — grouped into regions (crownfall,
  northmarch, deepvale) with safe/dangerous flags and frontend artwork keys.
- **Directed route graph**: 16 `TravelRoute` records (8 bidirectional roads,
  two records each), whole-second durations, Gold cost fixed at 0 until
  Phase 8. No arbitrary-destination travel: only direct neighbors are ever
  returned.
- **Typed local-feature registry** (`LocationFeature`, enum of INN, NPC_SHOP,
  MARKETPLACE, GATHERING, CRAFTING, COMBAT, QUEST, MUSEUM). Placement per
  spec: City = INN + MUSEUM; Market District = NPC_SHOP ×2 + MARKETPLACE +
  CRAFTING; Ironroot Mine = GATHERING + COMBAT; Blackwood Forest = COMBAT;
  North Road = COMBAT. The **Crownfall Forge is Market District features**
  (NPC_SHOP + CRAFTING sharing the name), never a location.
- **Current location on Character**: new characters start in Crownfall City;
  characters created before the world existed are lazily backfilled there.
  Feature availability comes from database records, not frontend
  conditionals.
- **Frontend location hub** (`/location`): original static artwork
  placeholder (asset-key driven), description, safe/dangerous badge, feature
  cards, and a connected-roads list with travel times. Local activities live
  on this page, not in global navigation. Nav gains only the Location link;
  unimplemented destinations stay hidden.

### Database

Migration `world_graph_locations`: `Location`, `LocationFeature` (unique
locationId+type+name), `TravelRoute` (unique from+to, directed), and
`Character.currentLocationId`. Seed extends idempotently.

### Endpoints

- `GET /api/v1/locations/current`
- `GET /api/v1/locations/current/features`
- `GET /api/v1/travel/destinations`

### Tests

Eight-location seed, explicit bidirectional route pairs with zero Gold cost
and no capital→mine shortcut, required feature placement, Forge-as-feature
(not location), starting/persistent current location, lazy backfill, feature
availability endpoint, direct-neighbor destination filtering from two
different locations. Playwright: register → create character → location hub
shows Crownfall City artwork, Inn + Museum cards, and exactly the three
connected roads.

### Known limitations

- Travel cannot be started yet (Phase 5); destination rows are informational.
- INN/MUSEUM/other feature cards are descriptive only until their owning
  phases activate actions.

## Phase 3 — Character, Progression, Recovery, and Starting State (2026-07-16)

**Status: complete.**

### Delivered

- **Three original classes** — Vanguard (frontline endurance), Wayfarer
  (speed and luck), Arcanist (elemental magic) — as seeded, data-driven
  `CharacterClassDefinition` rows (base stats + per-level growth). Nothing is
  hard-coded in services.
- **One character per account**, enforced by a unique database constraint on
  `Character.userId` (service returns 409; direct inserts also fail).
- **Level progression**: seeded `LevelProgression` table, cumulative XP for
  levels 1–20, validated strictly monotonic at seed time. Level cap is the
  highest seeded level. `addExperience` supports multi-level gains in one
  grant and fully restores HP/MP on level-up.
- **Derived stats** (max HP/MP, strength, agility, magic, defense, magic
  defense, luck) are computed from class + level — never duplicated in
  tables. Current HP/MP are stored; no passive HP/MP regeneration.
- **Stamina**: lazy timestamp regeneration at a configured whole-unit rate
  (1 per 5 minutes, `apps/api/src/config/game.ts`), computed on read and
  persisted only when spent (`spendStamina`, atomic, rejects shortfalls).
  No background jobs.
- **Gold belongs to the character** (BIGINT column, starting Gold 100,
  serialized as a decimal string); mutations wait for the Phase 7 currency
  service.
- **Crownfall Inn service definition** (`domain/inn/inn-service.ts`):
  level-scaled fee `5 + 2×level` Gold; activates with locations (Phase 4)
  and the ledger (Phase 7). No endpoint yet.
- **Frontend**: class-selection + naming creation page, character page with
  HP/MP/stamina bars, gold, XP progress, and attributes; Character nav link;
  redirect flows (no character → create; existing character → summary).

### Database

Migration `characters_progression`: `Character` (unique userId, unique name,
gold BIGINT, current HP/MP, stamina + timestamp), `CharacterClassDefinition`,
`LevelProgression`. Seed (`prisma/seed.mjs`, idempotent upserts, run by
`prepare-db` and compose startup) provides 3 classes and 20 levels.

### Endpoints

- `POST /api/v1/characters`, `GET /api/v1/characters/me`,
  `GET /api/v1/characters/me/stats`, `GET /api/v1/characters/classes`

### Tests

Seeded class/XP-table validation (3 classes, monotonic 20 levels), creation
with class starting statistics and starting gold, one-character constraint
(service + raw constraint), unknown class/duplicate name rejection,
NO_CHARACTER response, single-threshold level-up with HP/MP restore,
multi-level gain (100→level 2, +900→level 5), level-20 cap with null
xpForNextLevel, lazy stamina regeneration with clamping, and atomic stamina
spend with shortfall rejection. Playwright: register → create Arcanist →
stats visible → refresh persists → creation page redirects back.

### Known limitations

- Gold is display-only until the Phase 7 currency ledger.
- Stamina has no consumer yet (mining arrives in Phase 10); `spendStamina`
  is exercised by tests.

## Phase 2 — Authentication and Account Sessions (2026-07-16)

**Status: complete.**

### Delivered

- **Registration** (email + password + display name); accounts are active
  immediately — password reset and email verification are out of scope.
- **Sessions**: raw 256-bit token lives only in an HttpOnly, SameSite=Lax
  cookie (`Secure` in production); PostgreSQL stores only its SHA-256 hash.
  30-day expiry, lazy `lastUsedAt` touch, revocation support.
- **Password hashing** with Argon2id (19 MiB, t=2, p=1).
- **Token rotation** on login (always a fresh session) and on password change
  (old session revoked + new token issued atomically with the hash update).
- **CSRF protection**: per-session token stored server-side, returned via
  register/login/session responses, required as `X-CSRF-Token` together with
  an allow-listed `Origin` header on every state-changing `/api` request
  (Origin alone for unauthenticated register/login).
- **Rate limiting** on login and register (default 10/min/IP, configurable).
- **Generic credential errors**: identical 401 body for unknown email and
  wrong password.
- **Roles**: USER and ADMIN columns exist; no admin UI or admin routes yet.
- **Account settings**: theme (SYSTEM/LIGHT/DARK) persisted per user and
  applied as a class-based dark mode across the shell and UI foundation.
- **Frontend**: register/login/settings pages, authenticated route guard,
  auth-aware navigation (only implemented destinations), session-aware shell.

### Database

Migration `auth_accounts_sessions`: `User` (unique normalized email, unique
display name, Argon2id hash, role), `Session` (unique tokenHash, csrfToken,
expiry/revocation timestamps), `UserSettings` (theme), enums `UserRole`,
`Theme`.

### Endpoints

- `POST /api/v1/auth/register`, `POST /api/v1/auth/login` (rate-limited)
- `POST /api/v1/auth/logout`, `GET /api/v1/auth/session`
- `POST /api/v1/auth/change-password`, `POST /api/v1/auth/revoke-other-sessions`
- `GET/PATCH /api/v1/account/settings`

### Tests

API tests (real PostgreSQL, `rpg_test`, auto-prepared by
`scripts/prepare-db.mjs` via `pretest`): registration/activation, email
normalization + uniqueness, generic login errors, raw-token-never-stored,
refresh persistence, logout invalidation, revoke-other-sessions, password
change rotation, CSRF rejection (missing/wrong token), Origin rejection
(missing/unlisted), login rate limiting, settings defaults + partial update.
Playwright: full register → refresh → settings → sign out → guard redirect →
login journey against the production build with a real API and database
(`rpg_e2e`).

### Known limitations

- Rate limiting is per-process in-memory (single API process assumption;
  revisited in hardening).
- Running `npm test` now requires a reachable PostgreSQL (`docker compose up
postgres` or a local server); the DB is created and migrated automatically.

## Phase 1 — Foundation and Runtime Infrastructure (2026-07-16)

**Status: complete.**

### Delivered

- **API (`apps/api`)**: Fastify 5 under `/api/v1` with Zod validation
  (`fastify-type-provider-zod`), structured JSON logging with request IDs and
  secret/cookie/authorization redaction, generic production error envelope,
  `GET /api/v1/health` (200 ok / 503 degraded with database status), and
  OpenAPI documentation generated from route schemas at `/api/v1/docs`
  (documentation only — the frontend client is never generated from it).
- **Environment validation** at startup (`src/config/env.ts`): the API and
  worker refuse to start with invalid configuration and list every problem.
- **Worker (`apps/api/src/worker.ts`)**: separate pg-boss process; creates
  pg-boss infrastructure tables on first start; no job types registered yet.
- **Prisma** (`prisma/schema.prisma`): datasource/generator only — pg-boss
  manages its own tables and gameplay tables arrive with their owning phases,
  so there are no application models or migrations yet.
- **Shared contract (`packages/shared`)**: health and error-envelope Zod
  schemas; package now builds to `dist` and is consumed by both apps.
- **Web (`apps/web`)**: React 19, Vite 8, React Router 7, TanStack Query 5,
  and Tailwind CSS 4. Responsive shell (desktop sidebar, mobile top bar) with
  only implemented navigation (Home), neutral landing page, and a
  development-only API health indicator (absent from production builds).
  UI foundation: Button, Card, Dialog, LoadingState, ErrorState, EmptyState,
  Toast.
- **Docker Compose** (`compose.yaml`): PostgreSQL 17, API dev service, worker,
  and web dev service (Vite proxying `/api` to the API container).
- **Playwright** e2e baseline against the production web build via
  `vite preview` (the dev server is never the production server).

### Commands

| Command                                                      | Purpose                                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `docker compose up`                                          | PostgreSQL + API dev + worker + web dev (run `npm ci` on the host first)      |
| `npm run dev:api` / `npm run dev:worker` / `npm run dev:web` | Local dev processes without Docker                                            |
| `npm run build`                                              | Production builds: shared → API → static web assets                           |
| `npm run start:api`                                          | Production API process (requires `npm run build` and `DATABASE_URL`)          |
| `npm run start:worker`                                       | Production worker process (separate from the API)                             |
| `npm run db:generate`                                        | Generate the Prisma client                                                    |
| `npm run test:e2e`                                           | Playwright (set `PLAYWRIGHT_CHROMIUM_PATH` to reuse a pre-installed Chromium) |

### Tests

- Health endpoint: 200 with database ok, 503 degraded on database failure,
  OpenAPI spec exposure, generic 404 envelope.
- Environment validation: defaults, missing/invalid values, aggregated errors.
- Production builds verified for shared, API, and web; Playwright verifies the
  landing shell, implemented-only navigation, and that the dev health
  indicator is absent in production.

### Known limitations

- No gameplay: the landing page is a neutral shell; authentication is Phase 2.
- `docker compose up` was validated for config and its exact commands were
  exercised directly against local PostgreSQL; container image pulls were
  blocked by this build environment's network policy (Docker Hub CDN), so the
  full containerized boot should be confirmed on an unrestricted machine.

## Phase 0 — Repository Contract and Project Inspection (2026-07-16)

**Status: complete.**

The repository was empty; Phase 0 initialized it.

### Delivered

- npm-workspace monorepo: `apps/web`, `apps/api`, `packages/shared`,
  `prisma/`, `docs/` (workspaces are minimal placeholders; no gameplay, no
  server, no UI has been implemented).
- Node.js 22 LTS pinned in `.nvmrc` (`22.22.2`); Docker images (Phase 1) must
  use `node:22-bookworm-slim`.
- TypeScript strict mode via shared `tsconfig.base.json`.
- Architecture decision records in `docs/adr/`:
  - 0001 numeric representation (BIGINT Gold, decimal-string JSON, basis points)
  - 0002 API contracts (shared Zod schemas; OpenAPI is documentation only)
  - 0003 transaction boundaries (domain services, atomic transactions, raw SQL rules, idempotency keys)
  - 0004 timed-state finalization (lazy, timestamp-authoritative; pg-boss never sole authority)
  - 0005 random number generation (Node crypto / seeded deterministic PRNG with persisted counter)
  - 0006 lightweight synchronous domain events (in-process, same transaction; no bus)
  - 0007 process model and commands (`start:api`, `start:worker`; static frontend; version pinning)
- Repository-structure verification script and test.
- Baseline Vitest setup with passing tests.
- Prettier formatting configuration.

### Dependency versions (exact, resolved via committed `package-lock.json`)

All tooling dependencies are stable releases; no prerelease packages.

| Package     | Version |
| ----------- | ------- |
| typescript  | 5.9.3   |
| vitest      | 4.1.10  |
| prettier    | 3.9.5   |
| @types/node | 22.20.1 |

Runtime: Node.js 22 LTS (`.nvmrc` pins `22.22.2`).

### Commands

| Command                                   | Purpose                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `npm ci`                                  | Reproducible install from the committed lockfile                       |
| `npm run typecheck`                       | TypeScript strict type checking across workspaces                      |
| `npm test`                                | Vitest (structure test + baseline tests)                               |
| `npm run verify:structure`                | Standalone repository-structure check                                  |
| `npm run format` / `npm run format:check` | Prettier                                                               |
| `npm run start:api`                       | API process (placeholder until Phase 1; exits with a clear message)    |
| `npm run start:worker`                    | Worker process (placeholder until Phase 1; exits with a clear message) |

### Known limitations

- `start:api` and `start:worker` are contract placeholders that exit with an
  explanatory error; Phase 1 implements the real processes.
- No database, Docker Compose, or production build exists yet (Phase 1 scope).
