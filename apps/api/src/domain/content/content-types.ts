import type { PrismaClient } from '@prisma/client';
import {
  type ContentType,
  dialogueDefinitionPayloadSchema,
  equipmentSlotSchema,
  itemCategorySchema,
  narrativeFlagPayloadSchema,
} from '@rpg/shared';
import { z } from 'zod';

import { dialogueDependencies } from './dialogue-graph.js';

/** A stable-key reference to another definition, for the dependency graph. */
export interface ContentRef {
  type: ContentType;
  key: string;
}

/** A definition ready for a bundle: stable key + canonical payload. */
export interface ExportedDefinition {
  key: string;
  payload: Record<string, unknown>;
}

/** Everything the platform needs to know about one content type. */
export interface ContentTypeSpec {
  type: ContentType;
  /** Structural payload schema (referential rules live in content-validate). */
  payloadSchema: z.ZodTypeAny;
  /** Reads the live table into canonical, stable-key-referenced payloads. */
  exportAll(prisma: PrismaClient): Promise<ExportedDefinition[]>;
  /** Stable-key references this payload declares (edges in the graph). */
  dependencies(payload: Record<string, unknown>): ContentRef[];
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// --- payload schemas -------------------------------------------------------

const itemPayload = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  category: itemCategorySchema,
  stackable: z.boolean(),
  maxStackQuantity: z.number().int().min(1),
  equipmentSlot: equipmentSlotSchema.nullable(),
  levelRequirement: z.number().int().min(1),
  bonusStrength: z.number().int(),
  bonusAgility: z.number().int(),
  bonusMagic: z.number().int(),
  bonusDefense: z.number().int(),
  bonusMagicDefense: z.number().int(),
  bonusLuck: z.number().int(),
  bonusMaxHp: z.number().int(),
  bonusMaxMp: z.number().int(),
  hpRestore: z.number().int().min(0),
  mpRestore: z.number().int().min(0),
  usableInCombat: z.boolean(),
  baseValue: z.string().regex(/^\d+$/),
});

const locationPayload = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  region: z.string().min(1),
  description: z.string(),
  artworkKey: z.string(),
  isSafe: z.boolean(),
});

const routePayload = z.object({
  fromSlug: z.string().min(1),
  toSlug: z.string().min(1),
  travelSeconds: z.number().int().min(1),
  goldCost: z.string().regex(/^\d+$/),
});

const featurePayload = z.object({
  locationSlug: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  sortOrder: z.number().int(),
});

const modifierPayload = z.object({
  locationSlug: z.string().min(1),
  category: z.string().min(1),
  modifierBps: z.number().int(),
});

const shopPayload = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  locationSlug: z.string().min(1),
  markupBps: z.number().int(),
  sellbackBps: z.number().int(),
  poolConfig: z.record(z.string(), z.unknown()),
  restockIntervalSeconds: z.number().int().min(1),
  restockJitterSeconds: z.number().int().min(0),
});

const gatheringPayload = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  skill: z.string().min(1),
  locationSlug: z.string().min(1),
  levelRequirement: z.number().int().min(1),
  staminaCost: z.number().int().min(1),
  durationSeconds: z.number().int().min(1),
  xpReward: z.number().int().min(1),
  rewardTable: z.record(z.string(), z.unknown()),
  sortOrder: z.number().int(),
});

const recipePayload = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  profession: z.string().min(1),
  locationSlug: z.string().min(1),
  levelRequirement: z.number().int().min(1),
  goldCost: z.string().regex(/^\d+$/),
  durationSeconds: z.number().int().min(1),
  xpReward: z.number().int().min(1),
  inputs: z.array(z.object({ itemSlug: z.string().min(1), quantity: z.number().int().min(1) })),
  outputItemSlug: z.string().min(1),
  outputQuantity: z.number().int().min(1),
  sortOrder: z.number().int(),
});

const enemyPayload = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  level: z.number().int().min(1),
  maxHp: z.number().int().min(1),
  maxMp: z.number().int().min(0),
  strength: z.number().int(),
  agility: z.number().int(),
  magic: z.number().int(),
  defense: z.number().int(),
  magicDefense: z.number().int(),
  luck: z.number().int(),
  ranged: z.boolean(),
  affinities: z.record(z.string(), z.unknown()),
  aiConfig: z.record(z.string(), z.unknown()),
  rewardConfig: z.record(z.string(), z.unknown()),
});

const encounterPayload = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  locationSlug: z.string().min(1),
  kind: z.string().min(1),
  fleeable: z.boolean(),
  composition: z.array(z.record(z.string(), z.unknown())),
  fleeModifierBps: z.number().int(),
  unlockRequirements: z.record(z.string(), z.unknown()).nullable(),
  sortOrder: z.number().int(),
});

const questPayload = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  rewardXp: z.number().int().min(0),
  rewardGold: z.string().regex(/^\d+$/),
  rewardItems: z.array(
    z.object({ itemSlug: z.string().min(1), quantity: z.number().int().min(1) }),
  ),
  sortOrder: z.number().int(),
  objectives: z.array(
    z.object({
      sortOrder: z.number().int(),
      type: z.string().min(1),
      targetSlug: z.string().min(1),
      requiredCount: z.number().int().min(1),
      description: z.string(),
    }),
  ),
});

const collectionPayload = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  locationSlug: z.string().min(1),
  sortOrder: z.number().int(),
  entries: z.array(
    z.object({ itemSlug: z.string().min(1), curatorNote: z.string(), sortOrder: z.number().int() }),
  ),
});

const classPayload = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  baseHp: z.number().int(),
  baseMp: z.number().int(),
  baseStamina: z.number().int(),
  baseStrength: z.number().int(),
  baseAgility: z.number().int(),
  baseMagic: z.number().int(),
  baseDefense: z.number().int(),
  baseMagicDefense: z.number().int(),
  baseLuck: z.number().int(),
  growthHp: z.number().int(),
  growthMp: z.number().int(),
  growthStrength: z.number().int(),
  growthAgility: z.number().int(),
  growthMagic: z.number().int(),
  growthDefense: z.number().int(),
  growthMagicDefense: z.number().int(),
  growthLuck: z.number().int(),
});

const progressionPayload = z.object({
  levels: z.array(
    z.object({ level: z.number().int().min(1), cumulativeXp: z.number().int().min(0) }),
  ),
});

const NPC_ROLES = [
  'INNKEEPER',
  'MERCHANT',
  'CRAFTSPERSON',
  'TRAINER',
  'QUEST_GIVER',
  'CURATOR',
  'GUARD',
  'TRAVELER',
  'WORKER',
  'SCHOLAR',
  'AMBIENT',
] as const;

const NPC_SERVICE_TYPES = ['NONE', 'SHOP', 'INN', 'CRAFTING', 'MUSEUM', 'TRAINING'] as const;

const npcPayload = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  pronouns: z.string().min(1),
  shortDescription: z.string(),
  longDescription: z.string(),
  roles: z.array(z.enum(NPC_ROLES)).min(1),
  tags: z.array(z.string()),
  portraitAssetKey: z.string().min(1),
  sceneAssetKey: z.string().nullable(),
  homeRegion: z.string().min(1),
  serviceType: z.enum(NPC_SERVICE_TYPES),
  serviceRef: z.string().nullable(),
  dialogueKey: z.string().nullable(),
});

const WORLD_SEGMENTS = ['DAWN', 'DAY', 'DUSK', 'NIGHT'] as const;

const npcPlacementPayload = z.object({
  key: z.string().min(1),
  npcKey: z.string().min(1),
  locationSlug: z.string().min(1),
  segments: z.array(z.enum(WORLD_SEGMENTS)).min(1),
  priority: z.number().int(),
  visibility: z.string().min(1),
});

// --- the registry ----------------------------------------------------------

export const CONTENT_TYPE_SPECS: ContentTypeSpec[] = [
  {
    type: 'ITEM',
    payloadSchema: itemPayload,
    async exportAll(prisma) {
      const rows = await prisma.itemDefinition.findMany({ orderBy: { slug: 'asc' } });
      return rows.map((r) => ({
        key: r.slug,
        payload: {
          slug: r.slug,
          name: r.name,
          description: r.description,
          category: r.category,
          stackable: r.stackable,
          maxStackQuantity: r.maxStackQuantity,
          equipmentSlot: r.equipmentSlot,
          levelRequirement: r.levelRequirement,
          bonusStrength: r.bonusStrength,
          bonusAgility: r.bonusAgility,
          bonusMagic: r.bonusMagic,
          bonusDefense: r.bonusDefense,
          bonusMagicDefense: r.bonusMagicDefense,
          bonusLuck: r.bonusLuck,
          bonusMaxHp: r.bonusMaxHp,
          bonusMaxMp: r.bonusMaxMp,
          hpRestore: r.hpRestore,
          mpRestore: r.mpRestore,
          usableInCombat: r.usableInCombat,
          baseValue: r.baseValue.toString(),
        },
      }));
    },
    dependencies: () => [],
  },
  {
    type: 'LOCATION',
    payloadSchema: locationPayload,
    async exportAll(prisma) {
      const rows = await prisma.location.findMany({ orderBy: { slug: 'asc' } });
      return rows.map((r) => ({
        key: r.slug,
        payload: {
          slug: r.slug,
          name: r.name,
          region: r.region,
          description: r.description,
          artworkKey: r.artworkKey,
          isSafe: r.isSafe,
        },
      }));
    },
    dependencies: () => [],
  },
  {
    type: 'TRAVEL_ROUTE',
    payloadSchema: routePayload,
    async exportAll(prisma) {
      const rows = await prisma.travelRoute.findMany({
        include: {
          fromLocation: { select: { slug: true } },
          toLocation: { select: { slug: true } },
        },
      });
      return rows
        .map((r) => ({
          key: `${r.fromLocation.slug}->${r.toLocation.slug}`,
          payload: {
            fromSlug: r.fromLocation.slug,
            toSlug: r.toLocation.slug,
            travelSeconds: r.travelSeconds,
            goldCost: r.goldCost.toString(),
          },
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
    },
    dependencies: (p) => [
      { type: 'LOCATION', key: String(p['fromSlug']) },
      { type: 'LOCATION', key: String(p['toSlug']) },
    ],
  },
  {
    type: 'LOCATION_FEATURE',
    payloadSchema: featurePayload,
    async exportAll(prisma) {
      const rows = await prisma.locationFeature.findMany({
        include: { location: { select: { slug: true } } },
      });
      return rows
        .map((r) => ({
          key: `${r.location.slug}:${r.type}:${r.name}`,
          payload: {
            locationSlug: r.location.slug,
            type: r.type,
            name: r.name,
            description: r.description,
            sortOrder: r.sortOrder,
          },
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
    },
    dependencies: (p) => [{ type: 'LOCATION', key: String(p['locationSlug']) }],
  },
  {
    type: 'REGIONAL_PRICE_MODIFIER',
    payloadSchema: modifierPayload,
    async exportAll(prisma) {
      const rows = await prisma.regionalPriceModifier.findMany({
        include: { location: { select: { slug: true } } },
      });
      return rows
        .map((r) => ({
          key: `${r.location.slug}:${r.category}`,
          payload: {
            locationSlug: r.location.slug,
            category: r.category,
            modifierBps: r.modifierBps,
          },
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
    },
    dependencies: (p) => [{ type: 'LOCATION', key: String(p['locationSlug']) }],
  },
  {
    type: 'NPC_SHOP',
    payloadSchema: shopPayload,
    async exportAll(prisma) {
      const rows = await prisma.npcShop.findMany({
        include: { location: { select: { slug: true } } },
        orderBy: { slug: 'asc' },
      });
      return rows.map((r) => ({
        key: r.slug,
        payload: {
          slug: r.slug,
          name: r.name,
          description: r.description,
          locationSlug: r.location.slug,
          markupBps: r.markupBps,
          sellbackBps: r.sellbackBps,
          poolConfig: r.poolConfig as Record<string, unknown>,
          restockIntervalSeconds: r.restockIntervalSeconds,
          restockJitterSeconds: r.restockJitterSeconds,
        },
      }));
    },
    dependencies: (p) => {
      const pool = asArray(asRecord(p['poolConfig'])['pool']);
      const refs: ContentRef[] = [{ type: 'LOCATION', key: String(p['locationSlug']) }];
      for (const entry of pool)
        refs.push({ type: 'ITEM', key: String(asRecord(entry)['itemSlug']) });
      return refs;
    },
  },
  {
    type: 'GATHERING_ACTION',
    payloadSchema: gatheringPayload,
    async exportAll(prisma) {
      const rows = await prisma.gatheringActionDefinition.findMany({
        include: { location: { select: { slug: true } } },
        orderBy: { slug: 'asc' },
      });
      return rows.map((r) => ({
        key: r.slug,
        payload: {
          slug: r.slug,
          name: r.name,
          description: r.description,
          skill: r.skill,
          locationSlug: r.location.slug,
          levelRequirement: r.levelRequirement,
          staminaCost: r.staminaCost,
          durationSeconds: r.durationSeconds,
          xpReward: r.xpReward,
          rewardTable: r.rewardTable as Record<string, unknown>,
          sortOrder: r.sortOrder,
        },
      }));
    },
    dependencies: (p) => {
      const entries = asArray(asRecord(p['rewardTable'])['entries']);
      const refs: ContentRef[] = [{ type: 'LOCATION', key: String(p['locationSlug']) }];
      for (const e of entries) refs.push({ type: 'ITEM', key: String(asRecord(e)['itemSlug']) });
      return refs;
    },
  },
  {
    type: 'CRAFTING_RECIPE',
    payloadSchema: recipePayload,
    async exportAll(prisma) {
      const rows = await prisma.craftingRecipe.findMany({
        include: {
          location: { select: { slug: true } },
          outputItemDefinition: { select: { slug: true } },
        },
        orderBy: { slug: 'asc' },
      });
      return rows.map((r) => ({
        key: r.slug,
        payload: {
          slug: r.slug,
          name: r.name,
          description: r.description,
          profession: r.profession,
          locationSlug: r.location.slug,
          levelRequirement: r.levelRequirement,
          goldCost: r.goldCost.toString(),
          durationSeconds: r.durationSeconds,
          xpReward: r.xpReward,
          inputs: r.inputs,
          outputItemSlug: r.outputItemDefinition.slug,
          outputQuantity: r.outputQuantity,
          sortOrder: r.sortOrder,
        },
      }));
    },
    dependencies: (p) => {
      const refs: ContentRef[] = [
        { type: 'LOCATION', key: String(p['locationSlug']) },
        { type: 'ITEM', key: String(p['outputItemSlug']) },
      ];
      for (const input of asArray(p['inputs'])) {
        refs.push({ type: 'ITEM', key: String(asRecord(input)['itemSlug']) });
      }
      return refs;
    },
  },
  {
    type: 'ENEMY',
    payloadSchema: enemyPayload,
    async exportAll(prisma) {
      const rows = await prisma.enemyDefinition.findMany({ orderBy: { slug: 'asc' } });
      return rows.map((r) => ({
        key: r.slug,
        payload: {
          slug: r.slug,
          name: r.name,
          description: r.description,
          level: r.level,
          maxHp: r.maxHp,
          maxMp: r.maxMp,
          strength: r.strength,
          agility: r.agility,
          magic: r.magic,
          defense: r.defense,
          magicDefense: r.magicDefense,
          luck: r.luck,
          ranged: r.ranged,
          affinities: r.affinities as Record<string, unknown>,
          aiConfig: r.aiConfig as Record<string, unknown>,
          rewardConfig: r.rewardConfig as Record<string, unknown>,
        },
      }));
    },
    dependencies: (p) => {
      const drops = asArray(asRecord(p['rewardConfig'])['drops']);
      return drops.map((d) => ({ type: 'ITEM' as const, key: String(asRecord(d)['itemSlug']) }));
    },
  },
  {
    type: 'ENCOUNTER',
    payloadSchema: encounterPayload,
    async exportAll(prisma) {
      const rows = await prisma.encounterDefinition.findMany({
        include: { location: { select: { slug: true } } },
        orderBy: { slug: 'asc' },
      });
      return rows.map((r) => ({
        key: r.slug,
        payload: {
          slug: r.slug,
          name: r.name,
          description: r.description,
          locationSlug: r.location.slug,
          kind: r.kind,
          fleeable: r.fleeable,
          composition: r.composition,
          fleeModifierBps: r.fleeModifierBps,
          unlockRequirements: (r.unlockRequirements as unknown) ?? null,
          sortOrder: r.sortOrder,
        },
      }));
    },
    dependencies: (p) => {
      const refs: ContentRef[] = [{ type: 'LOCATION', key: String(p['locationSlug']) }];
      for (const member of asArray(p['composition'])) {
        refs.push({ type: 'ENEMY', key: String(asRecord(member)['enemySlug']) });
      }
      const unlock = asRecord(p['unlockRequirements']);
      const requires = unlock['requiresVictoryOverEncounterSlug'];
      if (typeof requires === 'string') refs.push({ type: 'ENCOUNTER', key: requires });
      return refs;
    },
  },
  {
    type: 'QUEST',
    payloadSchema: questPayload,
    async exportAll(prisma) {
      const rows = await prisma.questDefinition.findMany({
        include: { objectives: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { slug: 'asc' },
      });
      return rows.map((r) => ({
        key: r.slug,
        payload: {
          slug: r.slug,
          name: r.name,
          description: r.description,
          rewardXp: r.rewardXp,
          rewardGold: r.rewardGold.toString(),
          rewardItems: r.rewardItems,
          sortOrder: r.sortOrder,
          objectives: r.objectives.map((o) => ({
            sortOrder: o.sortOrder,
            type: o.type,
            targetSlug: o.targetSlug,
            requiredCount: o.requiredCount,
            description: o.description,
          })),
        },
      }));
    },
    dependencies: (p) => {
      const refs: ContentRef[] = [];
      for (const reward of asArray(p['rewardItems'])) {
        refs.push({ type: 'ITEM', key: String(asRecord(reward)['itemSlug']) });
      }
      for (const obj of asArray(p['objectives'])) {
        const o = asRecord(obj);
        const target = String(o['targetSlug']);
        switch (o['type']) {
          case 'TRAVEL_TO_LOCATION':
            refs.push({ type: 'LOCATION', key: target });
            break;
          case 'GATHER_ITEM':
          case 'DONATE_ITEM':
            refs.push({ type: 'ITEM', key: target });
            break;
          case 'CRAFT_RECIPE':
            refs.push({ type: 'CRAFTING_RECIPE', key: target });
            break;
          case 'DEFEAT_ENEMY':
            refs.push({ type: 'ENEMY', key: target });
            break;
          default:
            break;
        }
      }
      return refs;
    },
  },
  {
    type: 'COLLECTION',
    payloadSchema: collectionPayload,
    async exportAll(prisma) {
      const rows = await prisma.collectionDefinition.findMany({
        include: {
          location: { select: { slug: true } },
          entries: {
            include: { itemDefinition: { select: { slug: true } } },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { slug: 'asc' },
      });
      return rows.map((r) => ({
        key: r.slug,
        payload: {
          slug: r.slug,
          name: r.name,
          description: r.description,
          locationSlug: r.location.slug,
          sortOrder: r.sortOrder,
          entries: r.entries.map((e) => ({
            itemSlug: e.itemDefinition.slug,
            curatorNote: e.curatorNote,
            sortOrder: e.sortOrder,
          })),
        },
      }));
    },
    dependencies: (p) => {
      const refs: ContentRef[] = [{ type: 'LOCATION', key: String(p['locationSlug']) }];
      for (const e of asArray(p['entries'])) {
        refs.push({ type: 'ITEM', key: String(asRecord(e)['itemSlug']) });
      }
      return refs;
    },
  },
  {
    type: 'CHARACTER_CLASS',
    payloadSchema: classPayload,
    async exportAll(prisma) {
      const rows = await prisma.characterClassDefinition.findMany({ orderBy: { slug: 'asc' } });
      return rows.map((r) => ({ key: r.slug, payload: { ...r } }));
    },
    dependencies: () => [],
  },
  {
    type: 'LEVEL_PROGRESSION',
    payloadSchema: progressionPayload,
    async exportAll(prisma) {
      const rows = await prisma.levelProgression.findMany({ orderBy: { level: 'asc' } });
      return [
        {
          key: 'default',
          payload: { levels: rows.map((r) => ({ level: r.level, cumulativeXp: r.cumulativeXp })) },
        },
      ];
    },
    dependencies: () => [],
  },
  {
    type: 'NPC',
    payloadSchema: npcPayload,
    async exportAll(prisma) {
      const rows = await prisma.npcDefinition.findMany({ orderBy: { key: 'asc' } });
      return rows.map((r) => ({
        key: r.key,
        payload: {
          key: r.key,
          name: r.name,
          pronouns: r.pronouns,
          shortDescription: r.shortDescription,
          longDescription: r.longDescription,
          roles: r.roles,
          tags: r.tags,
          portraitAssetKey: r.portraitAssetKey,
          sceneAssetKey: r.sceneAssetKey,
          homeRegion: r.homeRegion,
          serviceType: r.serviceType,
          serviceRef: r.serviceRef,
          dialogueKey: r.dialogueKey,
        },
      }));
    },
    dependencies: () => [],
  },
  {
    type: 'NPC_PLACEMENT',
    payloadSchema: npcPlacementPayload,
    async exportAll(prisma) {
      const rows = await prisma.npcPlacement.findMany();
      return (
        rows
          .map((r) => ({
            key: `${r.npcKey}@${r.locationSlug}`,
            payload: {
              key: `${r.npcKey}@${r.locationSlug}`,
              npcKey: r.npcKey,
              locationSlug: r.locationSlug,
              segments: r.segments,
              priority: r.priority,
              visibility: r.visibility,
            },
          }))
          // Stable-key order so a re-export byte-matches the stored release
          // (getReleaseBundle orders by stableKey); the key is computed, so we
          // cannot ORDER BY it in the query.
          .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      );
    },
    dependencies: (p) => [
      { type: 'NPC', key: String(p['npcKey']) },
      { type: 'LOCATION', key: String(p['locationSlug']) },
    ],
  },
  {
    type: 'DIALOGUE',
    payloadSchema: dialogueDefinitionPayloadSchema,
    async exportAll(prisma) {
      const rows = await prisma.dialogueDefinition.findMany({ orderBy: { key: 'asc' } });
      return rows.map((r) => ({
        key: r.key,
        payload: {
          key: r.key,
          entryNodeId: r.entryNodeId,
          nodes: r.nodes as unknown[],
        },
      }));
    },
    dependencies: (p) => dialogueDependencies(p),
  },
  {
    type: 'NARRATIVE_FLAG',
    payloadSchema: narrativeFlagPayloadSchema,
    async exportAll(prisma) {
      const rows = await prisma.narrativeFlagDefinition.findMany({ orderBy: { key: 'asc' } });
      return rows.map((r) => ({
        key: r.key,
        payload: {
          key: r.key,
          namespace: r.namespace,
          valueType: r.valueType,
          allowedValues: r.allowedValues,
          defaultValue: r.defaultValue,
        },
      }));
    },
    dependencies: () => [],
  },
];

export const CONTENT_TYPE_SPEC_BY_TYPE = new Map(CONTENT_TYPE_SPECS.map((s) => [s.type, s]));
