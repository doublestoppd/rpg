import { ASSET_ROLES } from '@rpg/shared';

import { Asset } from '../../components/ui/Asset';
import { Card } from '../../components/ui/Card';
import { useAssetResolver } from '../assets/useAssets';

/**
 * Admin asset picker/gallery (Phase 21). Previews every bundled asset in its
 * real rendering path (the same <Asset> component players see), grouped by
 * role, with its stable key. Real art later replaces the files and shows up
 * here — and everywhere — with no code change.
 */
export function AssetGallery() {
  const resolver = useAssetResolver();

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold text-stone-900 dark:text-stone-100">
        Visual assets
      </h2>
      <p className="mb-3 text-sm text-stone-500 dark:text-stone-400">
        Bundled, checksummed placeholders. Each is previewed in the same component the game renders,
        and every content reference falls back to its role default.
      </p>
      <div className="space-y-4">
        {ASSET_ROLES.map((role) => {
          const assets = resolver.byRole(role);
          if (assets.length === 0) return null;
          return (
            <div key={role}>
              <p className="mb-1 font-mono text-xs uppercase text-stone-400">{role}</p>
              <ul className="flex flex-wrap gap-3">
                {assets.map((asset) => (
                  <li key={asset.key} className="w-24">
                    <Asset
                      assetRole={role}
                      assetKey={asset.key}
                      className="w-24 rounded border border-stone-200 dark:border-stone-700"
                    />
                    <p
                      className="mt-1 truncate font-mono text-[10px] text-stone-500"
                      title={asset.key}
                    >
                      {asset.key.split('/')[1]}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
