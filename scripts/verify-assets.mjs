#!/usr/bin/env node
/**
 * Build-time asset validation (Phase 21). Fails if the bundled assets and the
 * committed manifest have drifted, or if the manifest is internally
 * inconsistent. Guarantees the Phase 21 acceptance invariant that every visual
 * content reference has a valid fallback: every role has a file-backed default,
 * every fallback chain terminates at a real asset, and every referenced file
 * exists with a matching checksum.
 *
 *   node scripts/verify-assets.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'apps/web/public');
const MANIFEST_TS = join(ROOT, 'packages/shared/src/asset-manifest.generated.ts');

const ROLES = [
  'LOCATION_BANNER',
  'LOCATION_THUMBNAIL',
  'ITEM_ICON',
  'ENEMY_PORTRAIT',
  'CLASS_PORTRAIT',
  'NPC_PORTRAIT',
  'FEATURE_ICON',
  'QUEST_ICON',
  'COLLECTION_ART',
  'WORLD_MAP_NODE',
  'COMBAT_BACKGROUND',
  'STATUS_ICON',
  'ABILITY_ICON',
];

function loadManifest() {
  const source = readFileSync(MANIFEST_TS, 'utf8');
  const marker = 'ASSET_MANIFEST: AssetManifest =';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('cannot locate manifest literal');
  // The generated file is a TS object literal (Prettier may drop key quotes),
  // so evaluate it rather than JSON.parse. The file is generated and trusted.
  const literal = source
    .slice(start + marker.length)
    .replace(/}\s*as const;?\s*$/, '}')
    .trim();
  return Function(`"use strict"; return (${literal});`)();
}

const errors = [];
const fail = (msg) => errors.push(msg);

function main() {
  const manifest = loadManifest();
  const byKey = new Map(manifest.assets.map((a) => [a.key, a]));

  // Every role has a default asset that exists and matches its role.
  for (const role of ROLES) {
    const key = manifest.roleDefaults[role];
    if (!key) fail(`role ${role} has no default`);
    else {
      const asset = byKey.get(key);
      if (!asset) fail(`default ${key} for role ${role} is not in the manifest`);
      else if (asset.role !== role) fail(`default ${key} has role ${asset.role}, expected ${role}`);
    }
  }

  // Every asset file exists with a matching checksum; metadata is sane.
  for (const asset of manifest.assets) {
    if (!asset.path.startsWith('/')) fail(`${asset.key}: path must be app-absolute`);
    if (!asset.alt) fail(`${asset.key}: missing alt text`);
    const file = join(PUBLIC_DIR, asset.path);
    if (!existsSync(file)) {
      fail(`${asset.key}: file ${asset.path} does not exist`);
      continue;
    }
    const checksum = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (checksum !== asset.checksum) {
      fail(
        `${asset.key}: checksum drift (file ${checksum.slice(0, 12)}… vs manifest ${asset.checksum.slice(0, 12)}…)`,
      );
    }
  }

  // Every fallback chain terminates at a same-role asset (no cycles, no dangs).
  for (const asset of manifest.assets) {
    const seen = new Set();
    let cur = asset;
    while (cur.fallbackKey) {
      if (seen.has(cur.key)) {
        fail(`${asset.key}: fallback chain cycles at ${cur.key}`);
        break;
      }
      seen.add(cur.key);
      const next = byKey.get(cur.fallbackKey);
      if (!next) {
        fail(`${asset.key}: fallback ${cur.fallbackKey} is not in the manifest`);
        break;
      }
      if (next.role !== asset.role) {
        fail(`${asset.key}: fallback ${next.key} has a different role`);
        break;
      }
      cur = next;
    }
  }

  if (errors.length > 0) {
    console.error('Asset validation failed:');
    for (const e of errors) console.error(`  - ${e}`);
    console.error('\nIf you changed the art, run: npm run assets:generate');
    process.exit(1);
  }
  console.log(
    `Assets valid: ${manifest.assets.length} entries, ${ROLES.length} role defaults, all files and checksums match.`,
  );
}

main();
