#!/usr/bin/env node
/**
 * Generates the bundled placeholder assets and the asset manifest (Phase 21).
 *
 * Presentation is data: this script owns the canonical asset catalog, writes a
 * simple, consistent SVG placeholder per entry into apps/web/public/assets/game,
 * computes each file's SHA-256, and emits packages/shared/src/asset-manifest.
 * generated.ts. Real art later replaces the files and re-runs this script; no
 * component or API code changes. Deterministic: no timestamps or randomness.
 *
 *   node scripts/generate-assets.mjs
 *
 * `scripts/verify-assets.mjs` checks the committed output still matches.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'apps/web/public');
const ASSET_SUBDIR = 'assets/game';
const MANIFEST_TS = join(ROOT, 'packages/shared/src/asset-manifest.generated.ts');

/** Role → [aspectW, aspectH, pxWidth] and a palette for the placeholder. */
const ROLE_SPEC = {
  LOCATION_BANNER: { ar: [16, 9], w: 640, from: '#fcd9a1', to: '#e8935b', ink: '#7c3f14' },
  LOCATION_THUMBNAIL: { ar: [1, 1], w: 160, from: '#fde5b8', to: '#eaa66a', ink: '#7c3f14' },
  ITEM_ICON: { ar: [1, 1], w: 96, from: '#dbeafe', to: '#93c5fd', ink: '#1e3a8a' },
  ENEMY_PORTRAIT: { ar: [3, 4], w: 240, from: '#fecaca', to: '#ef6b6b', ink: '#7f1d1d' },
  CLASS_PORTRAIT: { ar: [3, 4], w: 240, from: '#ddd6fe', to: '#a78bfa', ink: '#4c1d95' },
  NPC_PORTRAIT: { ar: [3, 4], w: 240, from: '#d9f0e3', to: '#86c9a6', ink: '#14532d' },
  FEATURE_ICON: { ar: [1, 1], w: 72, from: '#e7e5e4', to: '#a8a29e', ink: '#44403c' },
  QUEST_ICON: { ar: [1, 1], w: 72, from: '#fef3c7', to: '#fcd34d', ink: '#78350f' },
  COLLECTION_ART: { ar: [4, 3], w: 320, from: '#fbcfe8', to: '#f0a6d0', ink: '#831843' },
  WORLD_MAP_NODE: { ar: [1, 1], w: 96, from: '#cbd5e1', to: '#94a3b8', ink: '#1e293b' },
  COMBAT_BACKGROUND: { ar: [16, 9], w: 960, from: '#94a3b8', to: '#334155', ink: '#e2e8f0' },
  STATUS_ICON: { ar: [1, 1], w: 64, from: '#fae8ff', to: '#e9a5f5', ink: '#701a75' },
  ABILITY_ICON: { ar: [1, 1], w: 72, from: '#bae6fd', to: '#60c5f2', ink: '#075985' },
};

/**
 * The canonical catalog. Each role has a `default` (the terminal fallback);
 * a few specific assets demonstrate specific-over-default and fallback chains.
 * `label` is the placeholder caption; `alt` is the accessible text.
 */
const CATALOG = [];
for (const role of Object.keys(ROLE_SPEC)) {
  const nice = role.toLowerCase().replace(/_/g, ' ');
  CATALOG.push({ role, name: 'default', label: nice, alt: `Placeholder ${nice}` });
}
// A handful of specific placeholders (still simple art), each falling back to
// its role default automatically via the resolver.
CATALOG.push(
  {
    role: 'LOCATION_BANNER',
    name: 'crownfall-city',
    label: 'Crownfall City',
    alt: 'Crownfall City banner',
  },
  {
    role: 'LOCATION_BANNER',
    name: 'greenmeadow-village',
    label: 'Greenmeadow',
    alt: 'Greenmeadow Village banner',
  },
  {
    role: 'LOCATION_BANNER',
    name: 'blackwood-forest',
    label: 'Blackwood',
    alt: 'Blackwood Forest banner',
  },
  { role: 'ITEM_ICON', name: 'copper-ore', label: 'Cu', alt: 'Copper ore icon' },
  { role: 'ENEMY_PORTRAIT', name: 'forest-slime', label: 'Slime', alt: 'Forest Slime portrait' },
);

const roleSlug = (role) => role.toLowerCase().replace(/_/g, '-');
const keyOf = (role, name) => `${roleSlug(role)}/${name}`;

function svgFor(role, entry) {
  const { ar, w, from, to, ink } = ROLE_SPEC[role];
  const h = Math.round((w * ar[1]) / ar[0]);
  const gid = `g-${roleSlug(role)}-${entry.name}`.replace(/[^a-z0-9-]/g, '');
  // A rounded frame, a diagonal gradient, a centred glyph, and a caption —
  // one consistent visual language across every role.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${entry.alt}">
  <defs>
    <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${Math.round(Math.min(w, h) * 0.08)}" fill="url(#${gid})" stroke="${ink}" stroke-opacity="0.25"/>
  <circle cx="${w / 2}" cy="${h * 0.42}" r="${Math.min(w, h) * 0.16}" fill="${ink}" fill-opacity="0.18"/>
  <text x="${w / 2}" y="${h * 0.8}" font-family="system-ui, sans-serif" font-size="${Math.round(Math.min(w, h) * 0.12)}" fill="${ink}" fill-opacity="0.85" text-anchor="middle">${entry.label}</text>
</svg>
`;
}

function main() {
  const outDir = join(PUBLIC_DIR, ASSET_SUBDIR);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const roleDefaults = {};
  const assets = [];
  for (const entry of CATALOG) {
    const { ar, w } = ROLE_SPEC[entry.role];
    const h = Math.round((w * ar[1]) / ar[0]);
    const key = keyOf(entry.role, entry.name);
    const fileName = `${roleSlug(entry.role)}__${entry.name}.svg`;
    const svg = svgFor(entry.role, entry);
    writeFileSync(join(outDir, fileName), svg);
    const checksum = createHash('sha256').update(svg).digest('hex');
    const isDefault = entry.name === 'default';
    if (isDefault) roleDefaults[entry.role] = key;
    assets.push({
      key,
      role: entry.role,
      path: `/${ASSET_SUBDIR}/${fileName}`,
      aspectRatio: `${ar[0]}:${ar[1]}`,
      width: w,
      height: h,
      focalPoint: null,
      alt: entry.alt,
      // Specific assets fall back to the role default; defaults are terminal.
      fallbackKey: isDefault ? null : (roleDefaults[entry.role] ?? keyOf(entry.role, 'default')),
      variant: 'default',
      checksum,
    });
  }
  assets.sort((a, b) => a.key.localeCompare(b.key));

  const manifest = { formatVersion: 1, roleDefaults, assets };
  const banner =
    '// AUTO-GENERATED by scripts/generate-assets.mjs — do not edit by hand.\n' +
    '// Run `npm run assets:generate` to regenerate; `npm run assets:verify` checks it.\n';
  const ts =
    banner +
    "import type { AssetManifest } from './assets.js';\n\n" +
    `export const ASSET_MANIFEST: AssetManifest = ${JSON.stringify(manifest, null, 2)} as const;\n`;
  writeFileSync(MANIFEST_TS, ts);

  const count = readdirSync(outDir).length;
  console.error(`assets: wrote ${count} files and ${assets.length} manifest entries`);
}

main();
