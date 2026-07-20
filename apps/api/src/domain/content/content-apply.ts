import type {
  EncounterKind,
  EquipmentSlot,
  ItemCategory,
  LocationFeatureType,
  ProfessionType,
  SkillType,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { ContentBundle, ContentType } from '@rpg/shared';

import { CONTENT_TYPE_SPECS } from './content-types.js';

/**
 * Materializes a validated content bundle into the live gameplay tables
 * (Phase 20). The engine keeps reading those tables (Phase 19), so applying a
 * published release is exactly how new content "goes live" without a code
 * deployment. Every write is an idempotent upsert keyed by stable key, so
 * publishing the full bundle is a no-op for unchanged definitions and never
 * deletes a live row (retirement, not deletion — historical records stay
 * resolvable).
 *
 * Appliers run in registry (dependency) order, so a definition's referenced
 * rows already exist by the time a dependent is applied; references are
 * resolved from stable key to primary key via the live table.
 */

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return '';
};
const int = (v: unknown): number => Number(v);
const bool = (v: unknown): boolean => v === true;
const json = (v: unknown): Prisma.InputJsonValue => v ?? {};

type Payload = Record<string, unknown>;
type Applier = (tx: Prisma.TransactionClient, payloads: Payload[]) => Promise<void>;

/** Resolves a location slug to its id, throwing if the location is absent. */
async function locationId(tx: Prisma.TransactionClient, slug: string): Promise<string> {
  const row = await tx.location.findUnique({ where: { slug }, select: { id: true } });
  if (!row) throw new Error(`apply: location "${slug}" not found`);
  return row.id;
}

async function itemId(tx: Prisma.TransactionClient, slug: string): Promise<string> {
  const row = await tx.itemDefinition.findUnique({ where: { slug }, select: { id: true } });
  if (!row) throw new Error(`apply: item "${slug}" not found`);
  return row.id;
}

const APPLIERS: Record<ContentType, Applier> = {
  ITEM: async (tx, payloads) => {
    for (const p of payloads) {
      const data = {
        name: str(p['name']),
        description: str(p['description']),
        category: str(p['category']) as ItemCategory,
        stackable: bool(p['stackable']),
        maxStackQuantity: int(p['maxStackQuantity']),
        equipmentSlot: (p['equipmentSlot'] ?? null) as EquipmentSlot | null,
        levelRequirement: int(p['levelRequirement']),
        bonusStrength: int(p['bonusStrength']),
        bonusAgility: int(p['bonusAgility']),
        bonusMagic: int(p['bonusMagic']),
        bonusDefense: int(p['bonusDefense']),
        bonusMagicDefense: int(p['bonusMagicDefense']),
        bonusLuck: int(p['bonusLuck']),
        bonusMaxHp: int(p['bonusMaxHp']),
        bonusMaxMp: int(p['bonusMaxMp']),
        hpRestore: int(p['hpRestore']),
        mpRestore: int(p['mpRestore']),
        usableInCombat: bool(p['usableInCombat']),
        baseValue: BigInt(str(p['baseValue'])),
      };
      await tx.itemDefinition.upsert({
        where: { slug: str(p['slug']) },
        create: { slug: str(p['slug']), ...data },
        update: data,
      });
    }
  },

  LOCATION: async (tx, payloads) => {
    for (const p of payloads) {
      const data = {
        name: str(p['name']),
        region: str(p['region']),
        description: str(p['description']),
        artworkKey: str(p['artworkKey']),
        isSafe: bool(p['isSafe']),
      };
      await tx.location.upsert({
        where: { slug: str(p['slug']) },
        create: { slug: str(p['slug']), ...data },
        update: data,
      });
    }
  },

  TRAVEL_ROUTE: async (tx, payloads) => {
    for (const p of payloads) {
      const fromLocationId = await locationId(tx, str(p['fromSlug']));
      const toLocationId = await locationId(tx, str(p['toSlug']));
      const data = { travelSeconds: int(p['travelSeconds']), goldCost: BigInt(str(p['goldCost'])) };
      await tx.travelRoute.upsert({
        where: { fromLocationId_toLocationId: { fromLocationId, toLocationId } },
        create: { fromLocationId, toLocationId, ...data },
        update: data,
      });
    }
  },

  LOCATION_FEATURE: async (tx, payloads) => {
    for (const p of payloads) {
      const locId = await locationId(tx, str(p['locationSlug']));
      const type = str(p['type']) as LocationFeatureType;
      const name = str(p['name']);
      const data = { description: str(p['description']), sortOrder: int(p['sortOrder']) };
      await tx.locationFeature.upsert({
        where: { locationId_type_name: { locationId: locId, type, name } },
        create: { locationId: locId, type, name, ...data },
        update: data,
      });
    }
  },

  REGIONAL_PRICE_MODIFIER: async (tx, payloads) => {
    for (const p of payloads) {
      const locId = await locationId(tx, str(p['locationSlug']));
      const category = str(p['category']) as ItemCategory;
      const data = { modifierBps: int(p['modifierBps']) };
      await tx.regionalPriceModifier.upsert({
        where: { locationId_category: { locationId: locId, category } },
        create: { locationId: locId, category, ...data },
        update: data,
      });
    }
  },

  NPC_SHOP: async (tx, payloads) => {
    for (const p of payloads) {
      const locId = await locationId(tx, str(p['locationSlug']));
      // Restock/runtime state is preserved on update; only content fields change.
      const content = {
        name: str(p['name']),
        description: str(p['description']),
        locationId: locId,
        markupBps: int(p['markupBps']),
        sellbackBps: int(p['sellbackBps']),
        poolConfig: json(p['poolConfig']),
        restockIntervalSeconds: int(p['restockIntervalSeconds']),
        restockJitterSeconds: int(p['restockJitterSeconds']),
      };
      await tx.npcShop.upsert({
        where: { slug: str(p['slug']) },
        create: { slug: str(p['slug']), ...content },
        update: content,
      });
    }
  },

  GATHERING_ACTION: async (tx, payloads) => {
    for (const p of payloads) {
      const locId = await locationId(tx, str(p['locationSlug']));
      const data = {
        name: str(p['name']),
        description: str(p['description']),
        skill: str(p['skill']) as SkillType,
        locationId: locId,
        levelRequirement: int(p['levelRequirement']),
        staminaCost: int(p['staminaCost']),
        durationSeconds: int(p['durationSeconds']),
        xpReward: int(p['xpReward']),
        rewardTable: json(p['rewardTable']),
        sortOrder: int(p['sortOrder']),
      };
      await tx.gatheringActionDefinition.upsert({
        where: { slug: str(p['slug']) },
        create: { slug: str(p['slug']), ...data },
        update: data,
      });
    }
  },

  CRAFTING_RECIPE: async (tx, payloads) => {
    for (const p of payloads) {
      const locId = await locationId(tx, str(p['locationSlug']));
      const outputItemDefinitionId = await itemId(tx, str(p['outputItemSlug']));
      const data = {
        name: str(p['name']),
        description: str(p['description']),
        profession: str(p['profession']) as ProfessionType,
        locationId: locId,
        levelRequirement: int(p['levelRequirement']),
        goldCost: BigInt(str(p['goldCost'])),
        durationSeconds: int(p['durationSeconds']),
        xpReward: int(p['xpReward']),
        inputs: json(p['inputs']),
        outputItemDefinitionId,
        outputQuantity: int(p['outputQuantity']),
        sortOrder: int(p['sortOrder']),
      };
      await tx.craftingRecipe.upsert({
        where: { slug: str(p['slug']) },
        create: { slug: str(p['slug']), ...data },
        update: data,
      });
    }
  },

  ENEMY: async (tx, payloads) => {
    for (const p of payloads) {
      const data = {
        name: str(p['name']),
        description: str(p['description']),
        level: int(p['level']),
        maxHp: int(p['maxHp']),
        maxMp: int(p['maxMp']),
        strength: int(p['strength']),
        agility: int(p['agility']),
        magic: int(p['magic']),
        defense: int(p['defense']),
        magicDefense: int(p['magicDefense']),
        luck: int(p['luck']),
        ranged: bool(p['ranged']),
        affinities: json(p['affinities']),
        aiConfig: json(p['aiConfig']),
        rewardConfig: json(p['rewardConfig']),
      };
      await tx.enemyDefinition.upsert({
        where: { slug: str(p['slug']) },
        create: { slug: str(p['slug']), ...data },
        update: data,
      });
    }
  },

  ENCOUNTER: async (tx, payloads) => {
    for (const p of payloads) {
      const locId = await locationId(tx, str(p['locationSlug']));
      const data = {
        name: str(p['name']),
        description: str(p['description']),
        locationId: locId,
        kind: str(p['kind']) as EncounterKind,
        fleeable: bool(p['fleeable']),
        composition: json(p['composition']),
        fleeModifierBps: int(p['fleeModifierBps']),
        unlockRequirements:
          p['unlockRequirements'] == null ? Prisma.JsonNull : json(p['unlockRequirements']),
        sortOrder: int(p['sortOrder']),
      };
      await tx.encounterDefinition.upsert({
        where: { slug: str(p['slug']) },
        create: { slug: str(p['slug']), ...data },
        update: data,
      });
    }
  },

  QUEST: async (tx, payloads) => {
    for (const p of payloads) {
      const data = {
        name: str(p['name']),
        description: str(p['description']),
        rewardXp: int(p['rewardXp']),
        rewardGold: BigInt(str(p['rewardGold'])),
        rewardItems: json(p['rewardItems']),
        sortOrder: int(p['sortOrder']),
      };
      const quest = await tx.questDefinition.upsert({
        where: { slug: str(p['slug']) },
        create: { slug: str(p['slug']), ...data },
        update: data,
      });
      // Objectives are upserted by (questId, sortOrder); never deleted, so any
      // in-flight QuestProgress rows keep their objective.
      for (const obj of asArray(p['objectives'])) {
        const o = asRecord(obj);
        const objData = {
          type: str(o['type']) as Prisma.QuestObjectiveCreateManyQuestInput['type'],
          targetSlug: str(o['targetSlug']),
          requiredCount: int(o['requiredCount']),
          description: str(o['description']),
        };
        await tx.questObjective.upsert({
          where: { questId_sortOrder: { questId: quest.id, sortOrder: int(o['sortOrder']) } },
          create: { questId: quest.id, sortOrder: int(o['sortOrder']), ...objData },
          update: objData,
        });
      }
    }
  },

  COLLECTION: async (tx, payloads) => {
    for (const p of payloads) {
      const locId = await locationId(tx, str(p['locationSlug']));
      const data = {
        name: str(p['name']),
        description: str(p['description']),
        locationId: locId,
        sortOrder: int(p['sortOrder']),
      };
      const collection = await tx.collectionDefinition.upsert({
        where: { slug: str(p['slug']) },
        create: { slug: str(p['slug']), ...data },
        update: data,
      });
      for (const entry of asArray(p['entries'])) {
        const e = asRecord(entry);
        const itemDefinitionId = await itemId(tx, str(e['itemSlug']));
        const entryData = { curatorNote: str(e['curatorNote']), sortOrder: int(e['sortOrder']) };
        await tx.collectionEntry.upsert({
          where: {
            collectionId_itemDefinitionId: { collectionId: collection.id, itemDefinitionId },
          },
          create: { collectionId: collection.id, itemDefinitionId, ...entryData },
          update: entryData,
        });
      }
    }
  },

  CHARACTER_CLASS: async (tx, payloads) => {
    for (const p of payloads) {
      const data = {
        name: str(p['name']),
        description: str(p['description']),
        baseHp: int(p['baseHp']),
        baseMp: int(p['baseMp']),
        baseStamina: int(p['baseStamina']),
        baseStrength: int(p['baseStrength']),
        baseAgility: int(p['baseAgility']),
        baseMagic: int(p['baseMagic']),
        baseDefense: int(p['baseDefense']),
        baseMagicDefense: int(p['baseMagicDefense']),
        baseLuck: int(p['baseLuck']),
        growthHp: int(p['growthHp']),
        growthMp: int(p['growthMp']),
        growthStrength: int(p['growthStrength']),
        growthAgility: int(p['growthAgility']),
        growthMagic: int(p['growthMagic']),
        growthDefense: int(p['growthDefense']),
        growthMagicDefense: int(p['growthMagicDefense']),
        growthLuck: int(p['growthLuck']),
      };
      await tx.characterClassDefinition.upsert({
        where: { slug: str(p['slug']) },
        create: { slug: str(p['slug']), ...data },
        update: data,
      });
    }
  },

  LEVEL_PROGRESSION: async (tx, payloads) => {
    for (const p of payloads) {
      for (const level of asArray(p['levels'])) {
        const l = asRecord(level);
        await tx.levelProgression.upsert({
          where: { level: int(l['level']) },
          create: { level: int(l['level']), cumulativeXp: int(l['cumulativeXp']) },
          update: { cumulativeXp: int(l['cumulativeXp']) },
        });
      }
    }
  },

  NPC: async (tx, payloads) => {
    for (const p of payloads) {
      const data = {
        name: str(p['name']),
        pronouns: str(p['pronouns']),
        shortDescription: str(p['shortDescription']),
        longDescription: str(p['longDescription']),
        roles: asArray(p['roles']).map(str),
        tags: asArray(p['tags']).map(str),
        portraitAssetKey: str(p['portraitAssetKey']),
        sceneAssetKey: p['sceneAssetKey'] == null ? null : str(p['sceneAssetKey']),
        homeRegion: str(p['homeRegion']),
        serviceType: str(p['serviceType']),
        serviceRef: p['serviceRef'] == null ? null : str(p['serviceRef']),
        dialogueKey: p['dialogueKey'] == null ? null : str(p['dialogueKey']),
        // Publishing an NPC (re)activates it; retirement is a separate action.
        status: 'PUBLISHED',
      };
      await tx.npcDefinition.upsert({
        where: { key: str(p['key']) },
        create: { key: str(p['key']), ...data },
        update: data,
      });
    }
  },

  NPC_PLACEMENT: async (tx, payloads) => {
    for (const p of payloads) {
      // Location existence is guaranteed by dependency-ordered application.
      await locationId(tx, str(p['locationSlug']));
      const data = {
        segments: asArray(p['segments']).map(str),
        priority: int(p['priority']),
        visibility: str(p['visibility']),
        status: 'PUBLISHED',
      };
      await tx.npcPlacement.upsert({
        where: {
          npcKey_locationSlug: { npcKey: str(p['npcKey']), locationSlug: str(p['locationSlug']) },
        },
        create: { npcKey: str(p['npcKey']), locationSlug: str(p['locationSlug']), ...data },
        update: data,
      });
    }
  },

  DIALOGUE: async (tx, payloads) => {
    for (const p of payloads) {
      const data = {
        entryNodeId: str(p['entryNodeId']),
        nodes: json(p['nodes']),
        status: 'PUBLISHED',
      };
      await tx.dialogueDefinition.upsert({
        where: { key: str(p['key']) },
        create: { key: str(p['key']), ...data },
        update: data,
      });
    }
  },

  NARRATIVE_FLAG: async (tx, payloads) => {
    for (const p of payloads) {
      const data = {
        namespace: str(p['namespace']),
        valueType: str(p['valueType']),
        allowedValues: asArray(p['allowedValues']).map(str),
        defaultValue: str(p['defaultValue']),
      };
      await tx.narrativeFlagDefinition.upsert({
        where: { key: str(p['key']) },
        create: { key: str(p['key']), ...data },
        update: data,
      });
    }
  },
};

/**
 * Applies every definition in the bundle to the live tables, in dependency
 * order. Must run inside the caller's publish transaction so content goes live
 * atomically with the release status flip and the audit row.
 */
export async function applyBundle(
  tx: Prisma.TransactionClient,
  bundle: ContentBundle,
): Promise<void> {
  const byType = new Map<ContentType, Payload[]>();
  for (const def of bundle.definitions) {
    const list = byType.get(def.type) ?? [];
    list.push(def.payload);
    byType.set(def.type, list);
  }
  for (const spec of CONTENT_TYPE_SPECS) {
    const payloads = byType.get(spec.type);
    if (payloads && payloads.length > 0) await APPLIERS[spec.type](tx, payloads);
  }
}
