/**
 * Content platform CLI (Phase 19): export, validate, import, and bootstrap
 * Release 1. Reads DATABASE_URL from the environment. Used by operators and by
 * the CI content-validation gate. Does not modify gameplay tables.
 *
 *   npm run content:export -- [outFile]
 *   npm run content:validate
 *   npm run content:release1
 *   npm run content:import -- <bundle.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { contentBundleSchema } from '@rpg/shared';

import { loadEnv } from './config/env.js';
import { stableStringify } from './domain/content/canonical.js';
import { createContentService } from './domain/content/content-service.js';
import { ensureNorthmarchPublished } from './domain/content/expansions/publish-expansion.js';
import { createPrismaClient } from './lib/prisma.js';

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const env = loadEnv();
  const prisma = createPrismaClient(env);
  const service = createContentService(prisma);
  try {
    switch (command) {
      case 'export': {
        const bundle = await service.exportCurrent('Export');
        const pretty = `${JSON.stringify(JSON.parse(stableStringify(bundle)), null, 2)}\n`;
        const out = process.argv[3];
        if (out) {
          writeFileSync(out, pretty);
          console.error(`exported ${bundle.definitions.length} definitions to ${out}`);
        } else {
          process.stdout.write(pretty);
        }
        break;
      }
      case 'validate': {
        const bundle = await service.exportCurrent('Validation');
        const result = service.validate(bundle);
        const errors = result.violations.filter((v) => v.severity === 'error');
        const warnings = result.violations.filter((v) => v.severity === 'warning');
        for (const w of warnings) console.error(`WARN  ${w.code}: ${w.message}`);
        for (const e of errors) console.error(`ERROR ${e.code}: ${e.message}`);
        if (result.ok) {
          console.error(
            `content valid: ${bundle.definitions.length} definitions, ${warnings.length} warning(s)`,
          );
          break;
        }
        process.exitCode = 1;
        break;
      }
      case 'release1': {
        const result = await service.ensureRelease1();
        console.error(
          result.created ? 'Release 1 created (PUBLISHED)' : 'Release 1 already exists',
        );
        break;
      }
      case 'expansion': {
        const name = process.argv[3];
        if (name !== 'northmarch') throw new Error('usage: content:expansion northmarch');
        const result = await ensureNorthmarchPublished(prisma);
        console.error(
          result.created
            ? `Northmarch expansion published (release v${result.version})`
            : `Northmarch expansion already published (release v${result.version})`,
        );
        break;
      }
      case 'import': {
        const file = process.argv[3];
        if (!file) throw new Error('usage: content:import -- <bundle.json>');
        const bundle = contentBundleSchema.parse(JSON.parse(readFileSync(file, 'utf-8')));
        const summary = await service.importDraft(bundle);
        print(summary);
        break;
      }
      default:
        console.error('usage: content-cli <export|validate|release1|import> [args]');
        process.exitCode = 2;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
