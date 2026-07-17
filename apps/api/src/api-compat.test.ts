import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compareOpenApi } from './lib/api-compat.js';
import { buildTestApp, createTestPrisma } from './test-helpers.js';

/**
 * API compatibility gate (Phase 13B). The committed baseline
 * (api-baseline.json) is a snapshot of the generated OpenAPI document;
 * the current API must keep every endpoint, property, enum, and required
 * field the baseline promises. Additions are always allowed. Regenerate on
 * intentional changes with: npm run api:baseline
 */

const BASELINE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'api-baseline.json');

let prisma: PrismaClient;
let app: FastifyInstance;
let currentSpec: unknown;

beforeAll(async () => {
  prisma = createTestPrisma();
  app = await buildTestApp(prisma);
  await app.ready();
  currentSpec = app.swagger();
  if (process.env['UPDATE_API_BASELINE'] === '1') {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(currentSpec, null, 2)}\n`);
  }
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('API compatibility', () => {
  it('the current API honors the committed baseline contract', () => {
    expect(existsSync(BASELINE_PATH), 'run: npm run api:baseline').toBe(true);
    const baseline: unknown = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
    expect(compareOpenApi(baseline, currentSpec)).toEqual([]);
  });

  it('detects removed endpoints', () => {
    const baseline = JSON.parse(JSON.stringify(currentSpec)) as {
      paths: Record<string, unknown>;
    };
    const mutated = JSON.parse(JSON.stringify(currentSpec)) as {
      paths: Record<string, unknown>;
    };
    delete mutated.paths['/api/v1/quests'];
    const violations = compareOpenApi(baseline, mutated);
    expect(violations.some((v) => v.includes('endpoint removed: /api/v1/quests'))).toBe(true);
  });

  it('detects removed response properties and changed enums', () => {
    const baseline = JSON.parse(JSON.stringify(currentSpec)) as Record<string, never>;
    const mutated = JSON.stringify(currentSpec)
      // Rename a response property everywhere it appears…
      .replaceAll('"activeCombatId"', '"renamedCombatId"')
      // …and mutate an enum member.
      .replaceAll('"COMPLETED_UNCLAIMED"', '"DONE_UNCLAIMED"');
    const violations = compareOpenApi(baseline, JSON.parse(mutated));
    expect(violations.some((v) => v.includes("property 'activeCombatId' was removed"))).toBe(true);
    expect(violations.some((v) => v.includes('enum changed'))).toBe(true);
  });

  it('detects required fields becoming optional', () => {
    const makeSpec = (required: string[]) => ({
      paths: {
        '/x': {
          post: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required,
                      properties: { gold: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const violations = compareOpenApi(makeSpec(['gold']), makeSpec([]));
    expect(violations.some((v) => v.includes("required field 'gold'"))).toBe(true);
  });
});
