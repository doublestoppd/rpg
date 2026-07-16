#!/usr/bin/env node
/**
 * Idempotent seed: upserts data-driven configuration (class definitions,
 * level progression). Safe to run on every deployment and test setup.
 */
import { PrismaClient } from '@prisma/client';

import { CHARACTER_CLASSES, LEVEL_PROGRESSION } from './seed-data.mjs';

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

  console.log(
    `seed: ${CHARACTER_CLASSES.length} classes, ${LEVEL_PROGRESSION.length} levels ensured`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
