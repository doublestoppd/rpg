import { type AssetRole, contentAssetKey } from '@rpg/shared';
import { useState } from 'react';

import { useAssetResolver } from '../../features/assets/useAssets';

interface AssetProps {
  assetRole: AssetRole;
  /** A content stable key (e.g. an item slug); resolved via the role convention. */
  contentKey?: string | null;
  /** An explicit asset key; wins over contentKey. */
  assetKey?: string | null;
  /** Override the manifest alt text (e.g. a specific location's name). */
  alt?: string;
  className?: string;
  /** When true, the image is decorative and hidden from assistive tech. */
  decorative?: boolean;
}

/**
 * Renders a bundled visual asset resolved from the manifest (Phase 21).
 * Swapping the asset behind a key changes what renders here with no change to
 * this component or its callers. A missing/unknown key always resolves to the
 * role default, so every reference renders something valid. A skeleton shows
 * until the image loads (respecting reduced-motion).
 */
export function Asset({ assetRole, contentKey, assetKey, alt, className, decorative }: AssetProps) {
  const resolver = useAssetResolver();
  const [loaded, setLoaded] = useState(false);

  const key = assetKey ?? (contentKey ? contentAssetKey(assetRole, contentKey) : null);
  const asset = resolver.resolve(assetRole, key);
  const objectPosition = asset.focalPoint
    ? `${Math.round(asset.focalPoint.x * 100)}% ${Math.round(asset.focalPoint.y * 100)}%`
    : undefined;

  return (
    <span
      className={`relative block overflow-hidden ${className ?? ''}`}
      style={{ aspectRatio: asset.aspectRatio.replace(':', ' / ') }}
    >
      {!loaded && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse bg-stone-200 motion-reduce:animate-none dark:bg-stone-800"
        />
      )}
      <img
        src={asset.path}
        alt={decorative ? '' : (alt ?? asset.alt)}
        aria-hidden={decorative || undefined}
        width={asset.width}
        height={asset.height}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`size-full object-cover transition-opacity duration-200 motion-reduce:transition-none ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
        style={objectPosition ? { objectPosition } : undefined}
        data-asset-key={asset.key}
      />
    </span>
  );
}
