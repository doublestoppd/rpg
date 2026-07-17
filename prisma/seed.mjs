#!/usr/bin/env node
/**
 * Idempotent seed: upserts data-driven configuration (class definitions,
 * level progression). Safe to run on every deployment and test setup.
 */
import { PrismaClient } from '@prisma/client';

import {
  CHARACTER_CLASSES,
  CRAFTING_RECIPES,
  ENCOUNTER_DEFINITIONS,
  ENEMY_DEFINITIONS,
  GATHERING_ACTIONS,
  ITEM_DEFINITIONS,
  LEVEL_PROGRESSION,
  LOCATION_FEATURES,
  LOCATIONS,
  NPC_SHOPS,
  REGIONAL_PRICE_MODIFIERS,
  TRAVEL_ROUTES,
} from './seed-data.mjs';

const prisma = new PrismaClient();

function validateLevelProgression(rows) {
  if (rows.length === 0) throw new Error('seed: level progression is empty');
  if (rows[0].level !== 1 || rows[0].cumulativeXp !== 0) {
    throw new Error('seed: level 1 must require 0 cumulative XP');
  }
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const next = rows[i];
    if (next.level !== prev.level + 1 || next.cumulativeXp <= prev.cumulativeXp) {
      throw new Error(
        `seed: level progression must be contiguous and strictly monotonic (level ${next.level})`,
      );
    }
  }
}

async function main() {
  validateLevelProgression(LEVEL_PROGRESSION);

  for (const cls of CHARACTER_CLASSES) {
    const { slug, ...data } = cls;
    await prisma.characterClassDefinition.upsert({
      where: { slug },
      create: { slug, ...data },
      update: data,
    });
  }

  for (const row of LEVEL_PROGRESSION) {
    await prisma.levelProgression.upsert({
      where: { level: row.level },
      create: row,
      update: { cumulativeXp: row.cumulativeXp },
    });
  }

  if (LOCATIONS.length !== 8) throw new Error('seed: the world has exactly eight locations');

  const locationIdBySlug = new Map();
  for (const loc of LOCATIONS) {
    const { slug, ...data } = loc;
    const row = await prisma.location.upsert({
      where: { slug },
      create: { slug, ...data },
      update: data,
    });
    locationIdBySlug.set(slug, row.id);
  }

  for (const feature of LOCATION_FEATURES) {
    const { locationSlug, ...data } = feature;
    const locationId = locationIdBySlug.get(locationSlug);
    if (!locationId) throw new Error(`seed: unknown location ${locationSlug} for feature`);
    await prisma.locationFeature.upsert({
      where: {
        locationId_type_name: { locationId, type: data.type, name: data.name },
      },
      create: { locationId, ...data },
      update: { description: data.description, sortOrder: data.sortOrder },
    });
  }

  for (const route of TRAVEL_ROUTES) {
    const fromLocationId = locationIdBySlug.get(route.fromSlug);
    const toLocationId = locationIdBySlug.get(route.toSlug);
    if (!fromLocationId || !toLocationId) {
      throw new Error(`seed: unknown location in route ${route.fromSlug} -> ${route.toSlug}`);
    }
    await prisma.travelRoute.upsert({
      where: { fromLocationId_toLocationId: { fromLocationId, toLocationId } },
      create: {
        fromLocationId,
        toLocationId,
        travelSeconds: route.travelSeconds,
        goldCost: route.goldCost,
      },
      update: { travelSeconds: route.travelSeconds, goldCost: route.goldCost },
    });
  }

  if (ITEM_DEFINITIONS.length !== 25)
    throw new Error('seed: the item catalog has exactly 25 items');
  for (const item of ITEM_DEFINITIONS) {
    const { slug, ...data } = item;
    await prisma.itemDefinition.upsert({
      where: { slug },
      create: { slug, ...data },
      update: data,
    });
  }

  for (const modifier of REGIONAL_PRICE_MODIFIERS) {
    const locationId = locationIdBySlug.get(modifier.locationSlug);
    if (!locationId)
      throw new Error(`seed: unknown location ${modifier.locationSlug} for modifier`);
    if (modifier.modifierBps < 1000 || modifier.modifierBps > 30000) {
      throw new Error(`seed: modifier out of sane range for ${modifier.locationSlug}`);
    }
    await prisma.regionalPriceModifier.upsert({
      where: { locationId_category: { locationId, category: modifier.category } },
      create: { locationId, category: modifier.category, modifierBps: modifier.modifierBps },
      update: { modifierBps: modifier.modifierBps },
    });
  }

  const itemSlugSet = new Set(ITEM_DEFINITIONS.map((i) => i.slug));
  for (const shop of NPC_SHOPS) {
    const locationId = locationIdBySlug.get(shop.locationSlug);
    if (!locationId) throw new Error(`seed: unknown location ${shop.locationSlug} for shop`);
    // Resale spread invariant: sellback strictly below markup.
    if (shop.sellbackBps >= shop.markupBps || shop.sellbackBps >= 10000) {
      throw new Error(`seed: ${shop.slug} sellback must be strictly below markup and 100%`);
    }
    if (!Number.isInteger(shop.poolConfig.restockSlots) || shop.poolConfig.restockSlots < 1) {
      throw new Error(`seed: ${shop.slug} restockSlots invalid`);
    }
    for (const entry of shop.poolConfig.pool) {
      if (!itemSlugSet.has(entry.itemSlug)) {
        throw new Error(`seed: ${shop.slug} pool references unknown item ${entry.itemSlug}`);
      }
      if (
        entry.weight < 1 ||
        entry.minQuantity < 1 ||
        entry.maxQuantity < entry.minQuantity ||
        entry.perCharacterLimit < 1
      ) {
        throw new Error(`seed: ${shop.slug} pool entry invalid for ${entry.itemSlug}`);
      }
    }
    const { slug, locationSlug, ...data } = shop;
    void locationSlug;
    await prisma.npcShop.upsert({
      where: { slug },
      create: { slug, locationId, ...data },
      update: { ...data, locationId },
    });
  }

  for (const action of GATHERING_ACTIONS) {
    const locationId = locationIdBySlug.get(action.locationSlug);
    if (!locationId) throw new Error(`seed: unknown location ${action.locationSlug} for action`);
    if (
      action.levelRequirement < 1 ||
      action.staminaCost < 1 ||
      action.durationSeconds < 1 ||
      action.xpReward < 1 ||
      action.rewardTable.entries.length < 1
    ) {
      throw new Error(`seed: ${action.slug} action definition invalid`);
    }
    for (const entry of action.rewardTable.entries) {
      if (!itemSlugSet.has(entry.itemSlug)) {
        throw new Error(`seed: ${action.slug} reward references unknown item ${entry.itemSlug}`);
      }
      if (entry.weight < 1 || entry.minQuantity < 1 || entry.maxQuantity < entry.minQuantity) {
        throw new Error(`seed: ${action.slug} reward entry invalid for ${entry.itemSlug}`);
      }
    }
    const { slug, locationSlug, ...data } = action;
    void locationSlug;
    await prisma.gatheringActionDefinition.upsert({
      where: { slug },
      create: { slug, locationId, ...data },
      update: { ...data, locationId },
    });
  }

  const itemIdBySlug = new Map();
  for (const item of ITEM_DEFINITIONS) {
    const row = await prisma.itemDefinition.findUnique({ where: { slug: item.slug } });
    itemIdBySlug.set(item.slug, row.id);
  }
  for (const recipe of CRAFTING_RECIPES) {
    const locationId = locationIdBySlug.get(recipe.locationSlug);
    if (!locationId) throw new Error(`seed: unknown location ${recipe.locationSlug} for recipe`);
    const outputItemDefinitionId = itemIdBySlug.get(recipe.outputItemSlug);
    if (!outputItemDefinitionId) {
      throw new Error(`seed: ${recipe.slug} outputs unknown item ${recipe.outputItemSlug}`);
    }
    if (
      recipe.levelRequirement < 1 ||
      recipe.goldCost < 0n ||
      recipe.durationSeconds < 1 ||
      recipe.xpReward < 1 ||
      recipe.outputQuantity < 1 ||
      recipe.inputs.length < 1
    ) {
      throw new Error(`seed: ${recipe.slug} recipe definition invalid`);
    }
    for (const input of recipe.inputs) {
      if (!itemSlugSet.has(input.itemSlug)) {
        throw new Error(`seed: ${recipe.slug} input references unknown item ${input.itemSlug}`);
      }
      if (!Number.isInteger(input.quantity) || input.quantity < 1) {
        throw new Error(`seed: ${recipe.slug} input quantity invalid for ${input.itemSlug}`);
      }
      if (input.itemSlug === recipe.outputItemSlug) {
        throw new Error(`seed: ${recipe.slug} output cannot be one of its own inputs`);
      }
    }
    const { slug, locationSlug, outputItemSlug, ...data } = recipe;
    void locationSlug;
    void outputItemSlug;
    await prisma.craftingRecipe.upsert({
      where: { slug },
      create: { slug, locationId, outputItemDefinitionId, ...data },
      update: { ...data, locationId, outputItemDefinitionId },
    });
  }

  const enemySlugSet = new Set(ENEMY_DEFINITIONS.map((e) => e.slug));
  for (const enemy of ENEMY_DEFINITIONS) {
    for (const element of ['FLAME', 'FROST', 'STORM', 'STONE']) {
      const bps = enemy.affinities[element];
      if (![0, 5000, 10000, 15000].includes(bps)) {
        throw new Error(`seed: ${enemy.slug} affinity ${element} must be 0/5000/10000/15000`);
      }
    }
    const totalWeight = enemy.aiConfig.actions.reduce((sum, a) => sum + a.weight, 0);
    if (totalWeight < 1) throw new Error(`seed: ${enemy.slug} AI weights invalid`);
    if (enemy.rewardConfig.goldMax < enemy.rewardConfig.goldMin || enemy.rewardConfig.xp < 1) {
      throw new Error(`seed: ${enemy.slug} reward config invalid`);
    }
    for (const drop of enemy.rewardConfig.drops) {
      if (!itemSlugSet.has(drop.itemSlug)) {
        throw new Error(`seed: ${enemy.slug} drop references unknown item ${drop.itemSlug}`);
      }
      if (drop.chanceBps < 1 || drop.chanceBps > 10000 || drop.maxQuantity < drop.minQuantity) {
        throw new Error(`seed: ${enemy.slug} drop entry invalid for ${drop.itemSlug}`);
      }
    }
    const { slug, ...data } = enemy;
    await prisma.enemyDefinition.upsert({
      where: { slug },
      create: { slug, ...data },
      update: data,
    });
  }

  const encounterSlugSet = new Set(ENCOUNTER_DEFINITIONS.map((e) => e.slug));
  for (const encounter of ENCOUNTER_DEFINITIONS) {
    const locationId = locationIdBySlug.get(encounter.locationSlug);
    if (!locationId) {
      throw new Error(`seed: unknown location ${encounter.locationSlug} for encounter`);
    }
    if (encounter.composition.length < 1) {
      throw new Error(`seed: ${encounter.slug} has no enemies`);
    }
    for (const member of encounter.composition) {
      if (!enemySlugSet.has(member.enemySlug)) {
        throw new Error(`seed: ${encounter.slug} references unknown enemy ${member.enemySlug}`);
      }
    }
    if (encounter.kind === 'BOSS' && encounter.fleeable) {
      throw new Error(`seed: boss ${encounter.slug} must not be fleeable`);
    }
    const requires = encounter.unlockRequirements?.requiresVictoryOverEncounterSlug;
    if (requires && !encounterSlugSet.has(requires)) {
      throw new Error(`seed: ${encounter.slug} requires unknown encounter ${requires}`);
    }
    const { slug, locationSlug, ...data } = encounter;
    void locationSlug;
    await prisma.encounterDefinition.upsert({
      where: { slug },
      create: { slug, locationId, ...data },
      update: { ...data, locationId },
    });
  }

  console.log(
    `seed: ${CHARACTER_CLASSES.length} classes, ${LEVEL_PROGRESSION.length} levels, ` +
      `${LOCATIONS.length} locations, ${LOCATION_FEATURES.length} features, ` +
      `${TRAVEL_ROUTES.length} routes, ${ITEM_DEFINITIONS.length} items, ` +
      `${REGIONAL_PRICE_MODIFIERS.length} price modifiers, ${NPC_SHOPS.length} shops, ` +
      `${GATHERING_ACTIONS.length} gathering actions, ${CRAFTING_RECIPES.length} recipes, ` +
      `${ENEMY_DEFINITIONS.length} enemies, ${ENCOUNTER_DEFINITIONS.length} encounters ensured`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
