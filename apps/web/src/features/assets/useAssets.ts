import {
  ASSET_MANIFEST,
  AssetResolver,
  type AssetsResponse,
  assetsResponseSchema,
} from '@rpg/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { apiGet } from '../../lib/api';

/** The compiled-in manifest, always available so the UI renders offline. */
const BUNDLED = new AssetResolver(ASSET_MANIFEST);

/**
 * Resolves visual assets against the manifest (Phase 21). Uses the bundled
 * manifest immediately and refreshes from GET /assets so a deployed asset swap
 * takes effect with no rebuild. Presentation is data: components never hardcode
 * an image path.
 */
export function useAssetResolver(): AssetResolver {
  const query = useQuery<AssetsResponse>({
    queryKey: ['assets', 'manifest'],
    queryFn: () => apiGet('/api/v1/assets', (raw) => assetsResponseSchema.parse(raw)),
    staleTime: 5 * 60_000,
    initialData: ASSET_MANIFEST,
  });
  return useMemo(() => (query.data ? new AssetResolver(query.data) : BUNDLED), [query.data]);
}
