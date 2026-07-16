#!/usr/bin/env node
/**
 * Idempotent seed: upserts data-driven configuration (class definitions,
 * level progression). Safe to run on every deployment and test setup.
 */
import { PrismaClient } from '@prisma/client';

import {
  CHARACTER_CLASSES,
  LEVEL_PROGRESSION,
  LOCATION_FEATURES,
  LOCATIONS,
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

  console.log(
    `seed: ${CHARACTER_CLASSES.length} classes, ${LEVEL_PROGRESSION.length} levels, ` +
      `${LOCATIONS.length} locations, ${LOCATION_FEATURES.length} features, ` +
      `${TRAVEL_ROUTES.length} routes ensured`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
