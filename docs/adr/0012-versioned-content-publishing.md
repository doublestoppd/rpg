# ADR 0012 — Versioned content and the publishing lifecycle

Status: accepted (Phase 19)

## Context

Items, locations, routes, features, shops, gathering actions, recipes, enemies,
encounters, quests, collections, and character/progression tables are the
game's _content_. They are also referenced by live player state: inventories,
transactions, combats, marketplace records, quest progress, museum donations,
and more. Turning these definition tables into unrestricted admin CRUD would
let an edit silently reinterpret data a player already holds (change what a
stored item _is_) or delete a definition that historical records still point
at.

Phase 19 introduces a content platform that makes content **versioned and
publishable** without changing gameplay, so later phases (a Content Studio UI,
world expansion, class/combat depth) build on a safe foundation.

## Decision

**Gameplay tables remain the runtime source of truth; the registry sits
alongside them.** The engine keeps reading the live definition tables exactly
as before, so "no gameplay change" is guaranteed by construction. The platform
is purely additive: two new tables, `ContentRelease` and `ContentDefinition`,
capture point-in-time, checksummed snapshots of that content. Nothing in the
gameplay read path changes.

**Content is addressed by stable keys, not database ids.** Every definition
exports under a stable key that is independent of primary keys — a slug
(`crownfall-city`), or a composite natural key where no slug exists
(`fromSlug->toSlug` for a route, `locationSlug:type:name` for a feature). Keys
are how one definition references another (a route's endpoints, a recipe's
inputs, a shop's restock pool), so a bundle is self-contained and portable.

**Releases move through a lifecycle: DRAFT → PUBLISHED → RETIRED.** An
administrator imports or authors a `DRAFT`, which is freely editable and
validated on every import. Publishing is an atomic, conditional flip
(`updateMany where status = 'DRAFT'`) that activates the whole release at once;
a stale or non-draft target returns 409. Retirement is another conditional flip
(`PUBLISHED → RETIRED`) that changes only the status — **definitions are never
destroyed**, so any historical record that pinned a revision keeps resolving.

**Published revisions are immutable at the database level.** A
`BEFORE UPDATE OR DELETE` trigger on `ContentDefinition` rejects any mutation of
a definition whose owning release is `PUBLISHED`. Immutability is enforced by
the database, not by application code that could be bypassed. Drafts stay
mutable until they are published; `INSERT` is always allowed, so a release is
assembled as a draft and then sealed by the publish flip.

**Export is deterministic and checksummed.** Payloads are canonicalized —
object keys sorted recursively, arrays kept in order, `BigInt` serialized as a
decimal string (ADR 0001), `undefined` dropped — and each definition carries a
SHA-256 checksum of its canonical form. Two exports of unchanged content are
byte-identical, so a diff or checksum detects any real change and a bundle can
be committed, reviewed, and re-imported reproducibly.

**A release is validated before it can be published, and again in CI.**
`validateBundle` rejects, as errors that block publication: duplicate or changed
stable keys, structurally invalid revisions, routes to unpublished locations,
disconnected world subgraphs (unless a location opts out with `isolated: true`),
recipe/reward/drop/quest/collection references that do not resolve, reward and
drop tables with invalid weights or quantity ranges, shops with an impossible
restock pool or a guaranteed sellback-above-markup arbitrage loop, collections
that list non-collectible items, quest objectives the engine does not
understand, and missing graphical asset keys. The `content:validate` command
runs the same rules against the seeded content on every CI build, so content
that cannot legally publish fails the pipeline.

**Release 1 is the current seeded content, bootstrapped idempotently.**
`content:release1` exports the live tables, validates them, and stores them as a
single `PUBLISHED` Release 1 — the acceptance test: _"import all current content
as Release 1 with no observable gameplay or API behavior change."_ It is
idempotent (a second run is a no-op) and creates no API surface: the platform is
CLI-only in Phase 19; the Content Studio UI is Phase 20.

## Consequences

- Content changes become reviewable, checksummed, atomically published, and
  reversible-by-retirement rather than by destructive edits.
- Historical player records never dangle: a retired definition still exists and
  still resolves by stable key.
- The engine is untouched, so this phase carries no gameplay or API-behavior
  risk; the OpenAPI baseline is unchanged.
- Future phases author content as drafts and publish new revisions instead of
  mutating live definition tables in place.
- The validation rules are the content contract; extending content types (Phase
  22+) means adding a `ContentTypeSpec` (schema + `exportAll` + `dependencies`)
  and, where needed, a new rule.
