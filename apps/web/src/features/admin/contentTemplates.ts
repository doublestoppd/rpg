import type { ContentType } from '@rpg/shared';

/**
 * Starter payloads for authoring a brand-new definition in the Content Studio.
 * These are minimal, structurally-shaped skeletons — the server still validates
 * every field on save, so a template only needs to give the author a correct
 * starting shape to fill in (not a publishable revision). Living-world types
 * (NPC, NPC_PLACEMENT, DIALOGUE, WORLD_EVENT, SCENE_VARIANT, NARRATIVE_FLAG) get
 * richer skeletons because they are the ones authored most often by hand.
 */
export function starterPayload(type: ContentType, key: string): Record<string, unknown> {
  const k = key.trim() || 'new-key';
  switch (type) {
    case 'ITEM':
      return {
        slug: k,
        name: '',
        description: '',
        category: 'RESOURCE',
        stackable: true,
        maxStackQuantity: 99,
        equipmentSlot: null,
        levelRequirement: 1,
        bonusStrength: 0,
        bonusAgility: 0,
        bonusMagic: 0,
        bonusDefense: 0,
        bonusMagicDefense: 0,
        bonusLuck: 0,
        bonusMaxHp: 0,
        bonusMaxMp: 0,
        hpRestore: 0,
        mpRestore: 0,
        usableInCombat: false,
        baseValue: '10',
      };
    case 'LOCATION':
      return {
        slug: k,
        name: '',
        region: '',
        description: '',
        artworkKey: `location/${k}`,
        isSafe: true,
      };
    case 'TRAVEL_ROUTE':
      return { fromSlug: '', toSlug: '', travelSeconds: 30, goldCost: '0' };
    case 'LOCATION_FEATURE':
      return { locationSlug: '', type: '', name: '', description: '', sortOrder: 0 };
    case 'REGIONAL_PRICE_MODIFIER':
      return { locationSlug: '', category: '', modifierBps: 0 };
    case 'NPC_SHOP':
      return {
        slug: k,
        name: '',
        description: '',
        locationSlug: '',
        markupBps: 2000,
        sellbackBps: 4000,
        poolConfig: { pool: [] },
        restockIntervalSeconds: 3600,
        restockJitterSeconds: 300,
      };
    case 'GATHERING_ACTION':
      return {
        slug: k,
        name: '',
        description: '',
        skill: 'MINING',
        locationSlug: '',
        levelRequirement: 1,
        staminaCost: 5,
        durationSeconds: 30,
        xpReward: 10,
        rewardTable: { entries: [] },
        sortOrder: 0,
      };
    case 'CRAFTING_RECIPE':
      return {
        slug: k,
        name: '',
        description: '',
        profession: 'BLACKSMITHING',
        locationSlug: '',
        levelRequirement: 1,
        goldCost: '0',
        durationSeconds: 30,
        xpReward: 10,
        inputs: [],
        outputItemSlug: '',
        outputQuantity: 1,
        sortOrder: 0,
      };
    case 'ENEMY':
      return {
        slug: k,
        name: '',
        description: '',
        level: 1,
        maxHp: 20,
        maxMp: 0,
        strength: 5,
        agility: 5,
        magic: 0,
        defense: 3,
        magicDefense: 3,
        luck: 1,
        ranged: false,
        affinities: {},
        aiConfig: {},
        rewardConfig: { drops: [] },
      };
    case 'ENCOUNTER':
      return {
        slug: k,
        name: '',
        description: '',
        locationSlug: '',
        kind: 'WILD',
        fleeable: true,
        composition: [],
        fleeModifierBps: 0,
        unlockRequirements: null,
        sortOrder: 0,
      };
    case 'QUEST':
      return {
        slug: k,
        name: '',
        description: '',
        rewardXp: 0,
        rewardGold: '0',
        rewardItems: [],
        sortOrder: 0,
        objectives: [],
      };
    case 'COLLECTION':
      return { slug: k, name: '', description: '', locationSlug: '', sortOrder: 0, entries: [] };
    case 'CHARACTER_CLASS':
      return {
        slug: k,
        name: '',
        description: '',
        baseHp: 100,
        baseMp: 50,
        baseStamina: 100,
        baseStrength: 10,
        baseAgility: 10,
        baseMagic: 10,
        baseDefense: 10,
        baseMagicDefense: 10,
        baseLuck: 10,
        growthHp: 10,
        growthMp: 5,
        growthStrength: 2,
        growthAgility: 2,
        growthMagic: 2,
        growthDefense: 2,
        growthMagicDefense: 2,
        growthLuck: 1,
      };
    case 'LEVEL_PROGRESSION':
      return { levels: [{ level: 1, cumulativeXp: 0 }] };
    case 'NPC':
      return {
        key: k,
        name: '',
        pronouns: 'they/them',
        shortDescription: '',
        longDescription: '',
        roles: ['AMBIENT'],
        tags: [],
        portraitAssetKey: `npc/${k}`,
        sceneAssetKey: null,
        homeRegion: '',
        serviceType: 'NONE',
        serviceRef: null,
        dialogueKey: null,
      };
    case 'NPC_PLACEMENT':
      return {
        key: `${k}@`,
        npcKey: k,
        locationSlug: '',
        segments: ['DAWN', 'DAY', 'DUSK', 'NIGHT'],
        priority: 0,
        visibility: 'LISTED',
      };
    case 'DIALOGUE':
      return {
        key: k,
        entryNodeId: 'start',
        nodes: [
          {
            id: 'start',
            speaker: 'NPC',
            text: '',
            choices: [{ id: 'leave', label: 'Farewell.', conditions: [], effects: [], to: null }],
          },
        ],
      };
    case 'NARRATIVE_FLAG':
      return {
        key: k,
        namespace: '',
        valueType: 'BOOLEAN',
        allowedValues: ['true', 'false'],
        defaultValue: 'false',
      };
    case 'WORLD_EVENT':
      return {
        key: k,
        name: '',
        description: '',
        eventType: 'FESTIVAL',
        region: '',
        locationSlug: null,
        everyCycles: 24,
        offsetCycles: 0,
        durationCycles: 4,
        priority: 10,
        sceneDescriptionKey: null,
      };
    case 'SCENE_VARIANT':
      return {
        key: k,
        locationSlug: '',
        priority: 10,
        segment: null,
        weather: null,
        eventType: null,
        narration: '',
      };
    default: {
      // Exhaustiveness guard: a new ContentType must get a template here.
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}
