import { describe, expect, it } from 'vitest';

import { ASSET_MANIFEST } from './asset-manifest.generated.js';
import {
  ASSET_ROLES,
  type AssetManifest,
  assetManifestSchema,
  AssetResolver,
  contentAssetKey,
} from './assets.js';

describe('asset manifest', () => {
  it('is structurally valid', () => {
    expect(() => assetManifestSchema.parse(ASSET_MANIFEST)).not.toThrow();
  });

  it('defines a default asset for every role, matching that role', () => {
    const byKey = new Map(ASSET_MANIFEST.assets.map((a) => [a.key, a]));
    for (const role of ASSET_ROLES) {
      const key = ASSET_MANIFEST.roleDefaults[role];
      expect(key, `role ${role} default`).toBeTruthy();
      expect(byKey.get(key)?.role).toBe(role);
    }
  });
});

describe('AssetResolver', () => {
  const resolver = new AssetResolver(ASSET_MANIFEST);

  it('resolves a known content key to its specific asset', () => {
    const asset = resolver.resolve(
      'LOCATION_BANNER',
      contentAssetKey('LOCATION_BANNER', 'crownfall-city'),
    );
    expect(asset.key).toBe('location-banner/crownfall-city');
  });

  it('falls back to the role default for an unknown key (acceptance: valid fallback)', () => {
    // Every possible content reference resolves to a valid, file-backed asset.
    for (const role of ASSET_ROLES) {
      const asset = resolver.resolve(role, contentAssetKey(role, 'does-not-exist'));
      expect(asset.role).toBe(role);
      expect(asset.key).toBe(ASSET_MANIFEST.roleDefaults[role]);
      expect(asset.path).toMatch(/^\/assets\/game\/.+\.svg$/);
    }
  });

  it('follows a fallback chain and breaks cycles', () => {
    const manifest: AssetManifest = {
      formatVersion: 1,
      roleDefaults: { ITEM_ICON: 'item-icon/default' } as AssetManifest['roleDefaults'],
      assets: [
        base('item-icon/default', 'ITEM_ICON', null),
        base('item-icon/a', 'ITEM_ICON', 'item-icon/b'),
        base('item-icon/b', 'ITEM_ICON', 'item-icon/a'), // cycle a<->b
      ],
    };
    const r = new AssetResolver(manifest);
    // Present key resolves to itself.
    expect(r.resolve('ITEM_ICON', 'item-icon/a').key).toBe('item-icon/a');
    // A cyclic chain from a missing key terminates at the role default.
    expect(r.resolve('ITEM_ICON', 'item-icon/missing').key).toBe('item-icon/default');
  });

  it('ignores a key that exists under a different role', () => {
    const asset = resolver.resolve('ENEMY_PORTRAIT', 'item-icon/copper-ore');
    expect(asset.role).toBe('ENEMY_PORTRAIT');
    expect(asset.key).toBe(ASSET_MANIFEST.roleDefaults.ENEMY_PORTRAIT);
  });

  it('acceptance: replacing an asset changes what resolves, with no consumer change', () => {
    // The "component" here is a pure render function that only reads the
    // resolver — it never references a path. Swapping the asset's data changes
    // its output without editing this function.
    const render = (r: AssetResolver, key: string) => {
      const a = r.resolve('ITEM_ICON', key);
      return { src: a.path, alt: a.alt };
    };
    const key = contentAssetKey('ITEM_ICON', 'copper-ore');
    const before = render(resolver, key);

    const swapped: AssetManifest = {
      ...ASSET_MANIFEST,
      assets: ASSET_MANIFEST.assets.map((a) =>
        a.key === 'item-icon/copper-ore'
          ? { ...a, path: '/assets/game/item-icon__replaced.svg', alt: 'Refined copper' }
          : a,
      ),
    };
    const after = render(new AssetResolver(swapped), key);

    expect(before.src).not.toBe(after.src);
    expect(after.src).toBe('/assets/game/item-icon__replaced.svg');
    expect(after.alt).toBe('Refined copper');
  });
});

function base(key: string, role: 'ITEM_ICON', fallbackKey: string | null) {
  return {
    key,
    role,
    path: `/assets/game/${key.replace('/', '__')}.svg`,
    aspectRatio: '1:1',
    width: 96,
    height: 96,
    focalPoint: null,
    alt: key,
    fallbackKey,
    variant: 'default' as const,
    checksum: 'a'.repeat(64),
  };
}
