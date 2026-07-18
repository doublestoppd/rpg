import { Asset } from '../../components/ui/Asset';

/**
 * Illustrated location header (Phase 21). The banner is a bundled visual asset
 * resolved from the manifest by the location's stable key; a location without a
 * specific banner falls back to the role default. Swapping the art is a data
 * change — this component never references an image path.
 */
export function LocationArtwork({ slug, name }: { slug: string; name: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg">
      <Asset
        assetRole="LOCATION_BANNER"
        contentKey={slug}
        alt={`${name} banner`}
        className="h-40 w-full"
      />
      <p className="absolute bottom-2 right-3 rounded bg-black/30 px-1.5 py-0.5 text-xs font-medium text-white/90 backdrop-blur-sm">
        {name}
      </p>
    </div>
  );
}
