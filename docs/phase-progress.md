# Phase Progress

Running log of completed build phases. Each entry records what the phase
delivered and the commands it introduced.

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
