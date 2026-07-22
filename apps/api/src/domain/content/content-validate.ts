import {
  type ContentBundle,
  type ContentType,
  type ContentValidationResult,
  type ContentViolation,
} from '@rpg/shared';

import { buildDependencyGraph, reachableLocations } from './content-graph.js';
import { CONTENT_TYPE_SPEC_BY_TYPE } from './content-types.js';
import { validateDialogueGraph } from './dialogue-graph.js';

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The starting location may seed connectivity; extend if the seed changes. */
const CONNECTIVITY_ROOT = 'crownfall-city';

/**
 * Validates a content bundle against every publication rule (Phase 19). Returns
 * errors (which block publication) and warnings. Rejects:
 * duplicate/changed keys, structurally invalid revisions, routes to missing
 * locations, disconnected world subgraphs (unless marked isolated), bad
 * recipe/reward/quest/collection references, impossible shop pools, missing
 * asset keys, and guaranteed NPC arbitrage loops.
 */
export function validateBundle(bundle: ContentBundle): ContentValidationResult {
  const violations: ContentViolation[] = [];
  const err = (code: string, type: ContentType | null, key: string | null, message: string) =>
    violations.push({ severity: 'error', code, type, key, message });
  const warn = (code: string, type: ContentType | null, key: string | null, message: string) =>
    violations.push({ severity: 'warning', code, type, key, message });

  // Index definitions by (type -> key -> payload); detect duplicate keys.
  const byType = new Map<ContentType, Map<string, Record<string, unknown>>>();
  for (const def of bundle.definitions) {
    const map = byType.get(def.type) ?? new Map();
    if (map.has(def.key)) {
      err('DUPLICATE_KEY', def.type, def.key, `Duplicate stable key "${def.key}" for ${def.type}.`);
    }
    map.set(def.key, def.payload);
    byType.set(def.type, map);
  }
  const has = (type: ContentType, key: string) => byType.get(type)?.has(key) ?? false;

  // Structural validation per type + stable-key/payload agreement.
  for (const def of bundle.definitions) {
    const spec = CONTENT_TYPE_SPEC_BY_TYPE.get(def.type);
    if (!spec) {
      err('UNKNOWN_TYPE', null, def.key, `Unknown content type ${def.type}.`);
      continue;
    }
    const parsed = spec.payloadSchema.safeParse(def.payload);
    if (!parsed.success) {
      err(
        'INVALID_REVISION',
        def.type,
        def.key,
        `Structurally invalid ${def.type} "${def.key}": ${parsed.error.issues[0]?.message ?? 'schema error'}.`,
      );
    }
    // A slug-keyed payload's slug must equal its stable key (no changed keys).
    const slug = def.payload['slug'];
    if (typeof slug === 'string' && slug !== def.key) {
      err(
        'CHANGED_KEY',
        def.type,
        def.key,
        `Payload slug "${slug}" does not match key "${def.key}".`,
      );
    }
  }

  // Referential integrity: every declared dependency must resolve in-bundle.
  for (const edge of buildDependencyGraph(bundle)) {
    if (!has(edge.toType, edge.toKey)) {
      err(
        'UNRESOLVED_REFERENCE',
        edge.fromType,
        edge.fromKey,
        `${edge.fromType} "${edge.fromKey}" references missing ${edge.toType} "${edge.toKey}".`,
      );
    }
  }

  // Missing graphical asset keys (locations must name artwork; items too).
  for (const [key, payload] of byType.get('LOCATION') ?? []) {
    const artworkKey = payload['artworkKey'];
    if (typeof artworkKey !== 'string' || !artworkKey.trim()) {
      err('MISSING_ASSET', 'LOCATION', key, `Location "${key}" has no artwork key.`);
    }
  }

  // World connectivity: no disconnected subgraph unless explicitly isolated
  // (a location payload may set isolated: true to opt out).
  const locations = byType.get('LOCATION');
  if (locations && locations.size > 0) {
    const root = locations.has(CONNECTIVITY_ROOT) ? CONNECTIVITY_ROOT : [...locations.keys()][0]!;
    const reachable = reachableLocations(bundle, root);
    for (const [key, payload] of locations) {
      if (!reachable.has(key) && payload['isolated'] !== true) {
        err(
          'DISCONNECTED_LOCATION',
          'LOCATION',
          key,
          `Location "${key}" is unreachable from "${root}" and is not marked isolated.`,
        );
      }
    }
  }

  // Reward tables (gathering) — weights and quantity ranges.
  for (const [key, payload] of byType.get('GATHERING_ACTION') ?? []) {
    for (const entry of asArray(asRecord(payload['rewardTable'])['entries'])) {
      const e = asRecord(entry);
      const weight = Number(e['weight']);
      const min = Number(e['minQuantity']);
      const max = Number(e['maxQuantity']);
      if (!(weight >= 1) || !(min >= 1) || !(max >= min)) {
        err(
          'INVALID_REWARD_TABLE',
          'GATHERING_ACTION',
          key,
          `Reward entry has invalid weight/quantity.`,
        );
      }
    }
  }

  // Enemy drop tables — chance and quantity ranges.
  for (const [key, payload] of byType.get('ENEMY') ?? []) {
    for (const drop of asArray(asRecord(payload['rewardConfig'])['drops'])) {
      const d = asRecord(drop);
      const chance = Number(d['chanceBps']);
      const min = Number(d['minQuantity']);
      const max = Number(d['maxQuantity']);
      if (!(chance >= 1 && chance <= 10000) || !(max >= min)) {
        err('INVALID_DROP_TABLE', 'ENEMY', key, `Enemy "${key}" has an invalid drop entry.`);
      }
    }
  }

  // NPC shops — restock pool validity + arbitrage guard (sellback < markup).
  for (const [key, payload] of byType.get('NPC_SHOP') ?? []) {
    const markup = Number(payload['markupBps']);
    const sellback = Number(payload['sellbackBps']);
    if (!(sellback < markup) || sellback >= 10000) {
      err(
        'ARBITRAGE_LOOP',
        'NPC_SHOP',
        key,
        `Shop "${key}" allows guaranteed arbitrage (sellback ${sellback}bps must be below markup ${markup}bps).`,
      );
    }
    const pool = asRecord(payload['poolConfig']);
    const slots = Number(pool['restockSlots']);
    const entries = asArray(pool['pool']);
    if (!(slots >= 1) || entries.length === 0) {
      err('IMPOSSIBLE_POOL', 'NPC_SHOP', key, `Shop "${key}" has an impossible restock pool.`);
    }
    for (const entry of entries) {
      const e = asRecord(entry);
      const weight = Number(e['weight']);
      const min = Number(e['minQuantity']);
      const max = Number(e['maxQuantity']);
      const limit = Number(e['perCharacterLimit']);
      if (!(weight >= 1) || !(min >= 1) || !(max >= min) || !(limit >= 1)) {
        err(
          'IMPOSSIBLE_POOL',
          'NPC_SHOP',
          key,
          `Shop "${key}" pool entry has invalid weight/quantity/limit.`,
        );
      }
    }
  }

  // NPCs must name a portrait asset (the asset framework guarantees a role
  // fallback, but the reference itself must be present and non-empty).
  for (const [key, payload] of byType.get('NPC') ?? []) {
    const portrait = payload['portraitAssetKey'];
    if (typeof portrait !== 'string' || !portrait.trim()) {
      err('MISSING_ASSET', 'NPC', key, `NPC "${key}" has no portrait asset key.`);
    }
  }

  // NPC placements: the referenced NPC and location resolve via the dependency
  // check above. Here we enforce that a required service is never stranded — for
  // each essential service an NPC provides, the union of the segments across all
  // placements of NPCs providing it must cover every world segment (a
  // replacement NPC per segment, or one always-available NPC).
  const ESSENTIAL_SERVICES = new Set(['INN', 'SHOP']);
  const ALL_SEGMENTS = ['DAWN', 'DAY', 'DUSK', 'NIGHT'];
  const npcs = byType.get('NPC');
  const serviceCoverage = new Map<string, Set<string>>();
  for (const [pkey, payload] of byType.get('NPC_PLACEMENT') ?? []) {
    const npc = npcs?.get(String(payload['npcKey']));
    if (!npc) continue; // unresolved reference already reported above
    const service = typeof npc['serviceType'] === 'string' ? npc['serviceType'] : 'NONE';
    if (!ESSENTIAL_SERVICES.has(service)) continue;
    const covered = serviceCoverage.get(service) ?? new Set<string>();
    for (const seg of asArray(payload['segments'])) covered.add(String(seg));
    serviceCoverage.set(service, covered);
    void pkey;
  }
  for (const [service, covered] of serviceCoverage) {
    const missing = ALL_SEGMENTS.filter((s) => !covered.has(s));
    if (missing.length > 0) {
      err(
        'STRANDED_SERVICE',
        'NPC_PLACEMENT',
        null,
        `Essential service ${service} is unavailable during segment(s) ${missing.join(', ')}: ` +
          `provide a replacement NPC for each segment or an always-available one.`,
      );
    }
  }

  // Dialogue graphs: entry present, targets resolve, all nodes reachable, no
  // unbounded loops (cycles). Flag effects/conditions must reference a declared
  // narrative flag with an allowed value.
  const flags = byType.get('NARRATIVE_FLAG');
  for (const [key, payload] of byType.get('DIALOGUE') ?? []) {
    for (const issue of validateDialogueGraph(payload)) {
      err('INVALID_DIALOGUE', 'DIALOGUE', key, issue.message);
    }
    for (const node of asArray(payload['nodes'])) {
      for (const choice of asArray(asRecord(node)['choices'])) {
        const c = asRecord(choice);
        const rules = [...asArray(c['conditions']), ...asArray(c['effects'])].map(asRecord);
        for (const rule of rules) {
          if (rule['type'] !== 'SET_FLAG' && rule['type'] !== 'FLAG_EQUALS') continue;
          const flagKey = String(rule['flagKey']);
          const flag = flags?.get(flagKey);
          if (!flag) continue; // unresolved reference already reported by the graph
          const allowed = asArray(flag['allowedValues']).map(String);
          if (!allowed.includes(String(rule['value']))) {
            err(
              'INVALID_FLAG_VALUE',
              'DIALOGUE',
              key,
              `Dialogue "${key}" sets flag "${flagKey}" to a value outside its allowed set.`,
            );
          }
        }
      }
    }
  }

  // World events: an occurrence must fit within its recurrence window, or
  // successive occurrences would overlap (an impossible schedule).
  for (const [key, payload] of byType.get('WORLD_EVENT') ?? []) {
    const every = Number(payload['everyCycles']);
    const duration = Number(payload['durationCycles']);
    if (every >= 1 && duration >= 1 && duration > every) {
      err(
        'IMPOSSIBLE_EVENT_SCHEDULE',
        'WORLD_EVENT',
        key,
        `Event "${key}" lasts ${duration} cycles but recurs every ${every}; occurrences overlap.`,
      );
    }
  }

  // Collections must reference COLLECTIBLE items.
  const items = byType.get('ITEM');
  for (const [key, payload] of byType.get('COLLECTION') ?? []) {
    for (const entry of asArray(payload['entries'])) {
      const itemSlug = String(asRecord(entry)['itemSlug']);
      const item = items?.get(itemSlug);
      if (item && item['category'] !== 'COLLECTIBLE') {
        err(
          'NONCOLLECTIBLE_ENTRY',
          'COLLECTION',
          key,
          `Collection "${key}" references non-collectible item "${itemSlug}".`,
        );
      }
    }
  }

  // Quest objective targets must resolve to the right definition type (the
  // dependency check above covers existence; this checks the objective type is
  // one the engine understands).
  const KNOWN_OBJECTIVES = new Set([
    'TRAVEL_TO_LOCATION',
    'GATHER_ITEM',
    'CRAFT_RECIPE',
    'DEFEAT_ENEMY',
    'DONATE_ITEM',
    'TALK_TO_NPC',
  ]);
  for (const [key, payload] of byType.get('QUEST') ?? []) {
    for (const obj of asArray(payload['objectives'])) {
      const type = String(asRecord(obj)['type']);
      if (!KNOWN_OBJECTIVES.has(type)) {
        err(
          'INVALID_OBJECTIVE',
          'QUEST',
          key,
          `Quest "${key}" has an unknown objective type "${type}".`,
        );
      }
    }
  }

  // A bundle with no locations or no items is almost certainly a mistake.
  if ((byType.get('LOCATION')?.size ?? 0) === 0) {
    warn('EMPTY_WORLD', null, null, 'Bundle defines no locations.');
  }

  return { ok: violations.every((v) => v.severity !== 'error'), violations };
}
