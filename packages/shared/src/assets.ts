import { z } from 'zod';

/**
 * Visual asset framework (Phase 21). Presentation is data, not code: content
 * references an asset by role + key, and the UI renders whatever the manifest
 * resolves. Every reference has a guaranteed fallback (ultimately the role
 * default), so a missing or not-yet-authored asset never breaks a screen, and
 * replacing an asset changes the presentation without touching any component.
 *
 * No binary blobs in the database and no arbitrary remote URLs: assets are
 * locally bundled files addressed by a stable key, validated at build time.
 */

export const assetRoleSchema = z.enum([
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
]);
export type AssetRole = z.infer<typeof assetRoleSchema>;

export const ASSET_ROLES = assetRoleSchema.options;

/** Light/dark theme or regional variant of the same logical asset. */
export const assetVariantSchema = z.enum(['default', 'light', 'dark']);
export type AssetVariant = z.infer<typeof assetVariantSchema>;

/** A point of interest for cropping, as fractions of width/height (0..1). */
export const focalPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type FocalPoint = z.infer<typeof focalPointSchema>;

export const assetDefinitionSchema = z.object({
  /** Stable, unique asset key (e.g. "location-banner/crownfall-city"). */
  key: z.string().min(1),
  role: assetRoleSchema,
  /** Bundled, app-relative URL of the asset file (e.g. "/assets/game/x.svg"). */
  path: z.string().min(1).startsWith('/'),
  /** Aspect ratio as "W:H" (e.g. "16:9", "1:1"). */
  aspectRatio: z.string().regex(/^\d+:\d+$/),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  focalPoint: focalPointSchema.nullable(),
  /** Accessible alternative text; never empty for a real asset. */
  alt: z.string().min(1),
  /** Next asset to try when this one is unavailable (chains to a role default). */
  fallbackKey: z.string().min(1).nullable(),
  variant: assetVariantSchema,
  /** SHA-256 of the bundled file, verified at build time. */
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
});
export type AssetDefinition = z.infer<typeof assetDefinitionSchema>;

export const assetManifestSchema = z.object({
  formatVersion: z.literal(1),
  /** The default asset key for each role (the terminal fallback). */
  roleDefaults: z.record(assetRoleSchema, z.string().min(1)),
  assets: z.array(assetDefinitionSchema),
});
export type AssetManifest = z.infer<typeof assetManifestSchema>;

/** GET /assets response: the manifest the client resolves against. */
export const assetsResponseSchema = assetManifestSchema;
export type AssetsResponse = z.infer<typeof assetsResponseSchema>;

/**
 * The conventional asset key for a content entity's visual in a given role,
 * e.g. contentAssetKey('ITEM_ICON', 'copper-ore') -> 'item-icon/copper-ore'.
 * A content reference need not have a specific asset; resolveAsset falls back
 * to the role default, so every reference always renders something valid.
 */
export function contentAssetKey(role: AssetRole, contentKey: string): string {
  return `${role.toLowerCase().replace(/_/g, '-')}/${contentKey}`;
}

export class AssetResolver {
  private readonly byKey: Map<string, AssetDefinition>;

  constructor(private readonly manifest: AssetManifest) {
    this.byKey = new Map(manifest.assets.map((a) => [a.key, a]));
  }

  /** Every asset in the manifest (for pickers and galleries). */
  all(): readonly AssetDefinition[] {
    return this.manifest.assets;
  }

  /** Assets in a given role. */
  byRole(role: AssetRole): AssetDefinition[] {
    return this.manifest.assets.filter((a) => a.role === role);
  }

  /** The role's default asset (the terminal fallback). Always present. */
  roleDefault(role: AssetRole): AssetDefinition {
    const key = this.manifest.roleDefaults[role];
    const asset = key ? this.byKey.get(key) : undefined;
    if (!asset) throw new Error(`asset manifest missing default for role ${role}`);
    return asset;
  }

  /**
   * Resolves a (role, key) to a concrete asset. Returns the keyed asset when it
   * exists in the right role; otherwise follows its fallback chain and finally
   * the role default. Guaranteed to return a valid asset; a fallback cycle is
   * broken and resolves to the role default.
   */
  resolve(role: AssetRole, key: string | null | undefined): AssetDefinition {
    const seen = new Set<string>();
    let nextKey = key ?? null;
    while (nextKey && !seen.has(nextKey)) {
      seen.add(nextKey);
      const candidate = this.byKey.get(nextKey);
      if (candidate && candidate.role === role) return candidate;
      nextKey = candidate?.fallbackKey ?? null;
    }
    return this.roleDefault(role);
  }
}
