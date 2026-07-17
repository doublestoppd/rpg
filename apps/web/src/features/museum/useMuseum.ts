import {
  type CollectionsResponse,
  collectionsResponseSchema,
  donateResponseSchema,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '../../lib/api';
import { INVENTORY_KEY } from '../inventory/useInventory';
import { QUESTS_KEY } from '../quests/useQuests';

export const COLLECTIONS_KEY = ['museum', 'collections'] as const;

export function useCollections(enabled = true) {
  return useQuery<CollectionsResponse>({
    queryKey: COLLECTIONS_KEY,
    queryFn: () => apiGet('/api/v1/collections', (raw) => collectionsResponseSchema.parse(raw)),
    enabled,
    staleTime: 10_000,
  });
}

export function useDonate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { collectionId: string; itemSlug: string }) =>
      apiSend(
        'POST',
        `/api/v1/collections/${input.collectionId}/donations`,
        { itemSlug: input.itemSlug },
        (raw) => donateResponseSchema.parse(raw),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COLLECTIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
      // Donations can complete the museum quest in the same transaction.
      void queryClient.invalidateQueries({ queryKey: QUESTS_KEY });
    },
  });
}
