# ADR 0014 — Visual asset framework

Status: accepted (Phase 21)

## Context

The game needs real presentation, and art must be replaceable without rewiring
components. The temptation is an image-upload system with database blobs and
arbitrary URLs; that couples content to storage, invites broken references, and
makes every screen a special case. Phase 21 instead establishes a stable **asset
contract** first: presentation becomes data that content references by key.

The acceptance test frames the design: (1) every visual content reference has a
valid fallback, and (2) replacing an asset assigned to a content revision
changes the presentation without changing React components.

## Decision

**Assets are locally bundled files addressed by a stable key — no database
blobs, no remote URLs.** Each asset definition carries: a stable key, a role
(one of a fixed set — `LOCATION_BANNER`, `ITEM_ICON`, `ENEMY_PORTRAIT`, …), a
bundled app-relative path, aspect ratio and pixel dimensions, an optional focal
point, accessible alt text, an optional fallback key, a light/dark/regional
variant, and a SHA-256 checksum. The catalog lives in a single generated
manifest; the files live under `apps/web/public/assets/game`.

**One generator owns the catalog and files; a verifier guards them.**
`scripts/generate-assets.mjs` writes a consistent placeholder SVG per entry,
computes each checksum, and emits `packages/shared/src/asset-manifest.
generated.ts`. `scripts/verify-assets.mjs` (a CI gate and a test) fails if any
file is missing, any checksum has drifted, any fallback chain dangles or cycles,
or any role lacks a default. Replacing the placeholders with real art is: drop
in the files, re-run the generator, commit — no component or API change.

**Resolution guarantees a valid asset for every reference.** Content references
an asset by role + key (by convention `contentAssetKey(role, contentKey)`, e.g.
`item-icon/copper-ore`). `AssetResolver.resolve(role, key)` returns the keyed
asset when present in that role; otherwise it follows the fallback chain and
finally the role default. Because every role has a file-backed default, an
unknown or not-yet-authored key always renders something valid — satisfying
acceptance (1). A fallback cycle is detected and resolves to the role default.

**Presentation is data; components read the resolver.** The `<Asset>` component
takes a role and a content/asset key and renders whatever the resolver returns —
it never hardcodes a path. Swapping an asset's manifest entry (path, alt, focal
point) changes what every `<Asset>` renders with zero component edits, which is
acceptance (2). The manifest is served at `GET /assets` (public, cacheable,
compiled-in data) so a deployed swap can also take effect at runtime; the client
falls back to the bundled manifest so it always renders offline.

**The contract ships now; breadth follows.** The framework, the bundled
placeholders, the validation gate, and the resolver are complete. The player-UI
refresh applies `<Asset>` incrementally (location banners, item icons, and the
admin asset gallery in this phase) plus skeleton loading and reduced-motion
handling; remaining surfaces adopt the same component without further framework
changes.

## Consequences

- No broken art: every reference resolves to a valid, checksummed, bundled file.
- Art is swappable by data, reviewable by checksum diff, and validated in CI.
- No binary storage in the database and no remote-URL fetching, consistent with
  the project's security posture.
- New content types get visuals for free via the role convention and role
  defaults; authoring specific art is optional, never required to render.
