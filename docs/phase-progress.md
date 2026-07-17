# Phase Progress

Running log of completed build phases. Each entry records what the phase
delivered and the commands it introduced.

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
