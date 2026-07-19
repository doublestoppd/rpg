# ADR 0015 — Content-driven world expansion (Northmarch)

Status: accepted (Phase 22)

## Context

The first large gameplay expansion — the Northmarch region, with Herbalism and
Alchemy — is also the first real test of the content platform (Phases 19–20):
can a whole region ship as _content_ rather than as code and seed edits? The
acceptance test draws the line: the region and its ordinary definitions are
created through the Content Studio; code changes are limited to genuinely new
mechanics and reusable presentation.

## Decision

**Ordinary content ships as a published content release, not as seed.** Every
Northmarch location, route, feature, item, gathering action, recipe, enemy,
encounter, quest, collection, shop, and price modifier is authored as versioned
content definitions and published through the platform: validate the full
bundle, store it as a release, and apply it to the live tables the engine reads
(apply-on-publish, Phase 20). The published bundle is the live content _plus_
the Northmarch additions — a complete, self-consistent bundle — so every
reference resolves and validation passes, exactly as when an administrator
clones the live content in the Studio and adds to it. `prisma/seed.mjs` is
untouched; the expansion is `npm run content:expansion northmarch` (idempotent).

**Only genuinely new mechanics are code.** Herbalism (a timed gathering
profession) and Alchemy (a timed crafting profession) widen two enum domains
(`SkillType += HERBALISM`, `ProfessionType += ALCHEMY`) and make the gathering
and crafting engines multi-track: XP now accrues to the action's own skill and
the recipe's own profession, and each surface shows progress for the skill or
profession its location actually offers. Everything else — stored-outcome rolls,
capacity holds, lazy finalization, idempotency, one-run-per-character, and
worker-offline safety — is unchanged and inherited: the new professions run on
the same engine as Mining and Blacksmithing. No new gathering or crafting code
path exists; only the skill/profession is now a variable rather than a constant.

**Regions and remote delivery are already data-driven.** Marketplace regions
are derived from shop rows, so the Northmarch shops make `northmarch` a valid
remote-delivery destination with no marketplace code change. Region-specific
prices are ordinary `REGIONAL_PRICE_MODIFIER` content. Gold and material sinks
(recipe fees and reagent consumption, shop markups) are properties of the
authored content.

**Presentation labels are reusable, not per-profession.** The gathering and
crafting panels now render the skill/profession name from the response
(`SKILL_LABELS`, `PROFESSION_LABELS`) instead of the words "Mining" and
"Blacksmithing", so the same components serve every current and future
profession. This is the only player-facing code change.

**The level cap stays at 20.** Northmarch fills the early-to-mid range; raising
the cap and deepening builds is Phase 23. Northmarch content is authored for
low-level play so the existing progression range gains content before it is
extended.

## Consequences

- A whole region shipped without a schema change to gameplay tables and without
  editing the seed — proving the content platform carries real expansions.
- New professions cost two enum values and a small generalization, not a new
  engine, so all the hard-won timed-action guarantees hold automatically.
- Content is reviewable as a validated bundle and reversible by retirement, and
  historical player records never dangle (apply is upsert-only).
- Future expansions follow the same recipe: author content, add code only for
  mechanics that genuinely do not exist yet.
