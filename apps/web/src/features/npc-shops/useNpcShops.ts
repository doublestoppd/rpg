import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  npcShopDetailResponseSchema,
  npcShopListResponseSchema,
  npcShopPurchaseResponseSchema,
  type NpcShopDetailResponse,
  type NpcShopListResponse,
  type NpcShopPurchaseRequest,
} from '@rpg/shared';

import { apiGet, apiSend } from '../../lib/api';
import { INVENTORY_KEY } from '../inventory/useInventory';
import { CURRENCY_KEY, TRANSACTIONS_KEY } from '../currency/useCurrency';

export const LOCAL_SHOPS_KEY = ['npc-shops', 'local'] as const;
export const shopDetailKey = (shopId: string) => ['npc-shops', 'detail', shopId] as const;

export function useLocalShops(enabled = true) {
  return useQuery<NpcShopListResponse>({
    queryKey: LOCAL_SHOPS_KEY,
    queryFn: () => apiGet('/api/v1/npc-shops', (raw) => npcShopListResponseSchema.parse(raw)),
    enabled,
    staleTime: 10_000,
  });
}

export function useShopDetail(shopId: string | undefined) {
  return useQuery<NpcShopDetailResponse>({
    queryKey: shopDetailKey(shopId ?? 'none'),
    queryFn: () =>
      apiGet(`/api/v1/npc-shops/${shopId}`, (raw) => npcShopDetailResponseSchema.parse(raw)),
    enabled: Boolean(shopId),
    staleTime: 5_000,
  });
}

export function usePurchase(shopId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NpcShopPurchaseRequest) =>
      apiSend('POST', `/api/v1/npc-shops/${shopId}/purchases`, input, (raw) =>
        npcShopPurchaseResponseSchema.parse(raw),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shopDetailKey(shopId) });
      void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
      void queryClient.invalidateQueries({ queryKey: CURRENCY_KEY });
      void queryClient.invalidateQueries({ queryKey: TRANSACTIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['character', 'me'] });
    },
  });
}
