import {
  type BountyBoardResponse,
  bountyBoardResponseSchema,
  type ClaimBountyResponse,
  claimBountyResponseSchema,
  type SalvageResponse,
  salvageResponseSchema,
  type SellbackResponse,
  sellbackResponseSchema,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '../../lib/api';
import { CURRENCY_KEY, TRANSACTIONS_KEY } from '../currency/useCurrency';
import { INVENTORY_KEY } from '../inventory/useInventory';
import { shopDetailKey } from '../npc-shops/useNpcShops';

export const BOUNTY_BOARD_KEY = ['activities', 'bounties'] as const;

const newKey = () => crypto.randomUUID().replaceAll('-', '');

export function useBountyBoard(enabled = true) {
  return useQuery<BountyBoardResponse>({
    queryKey: BOUNTY_BOARD_KEY,
    queryFn: () => apiGet('/api/v1/bounties', (raw) => bountyBoardResponseSchema.parse(raw)),
    enabled,
    staleTime: 10_000,
  });
}

export function useClaimBounty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bountySlug: string) =>
      apiSend<ClaimBountyResponse>(
        'POST',
        `/api/v1/bounties/${bountySlug}/claims`,
        { idempotencyKey: newKey() },
        (raw) => claimBountyResponseSchema.parse(raw),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BOUNTY_BOARD_KEY });
      void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
      void queryClient.invalidateQueries({ queryKey: CURRENCY_KEY });
      void queryClient.invalidateQueries({ queryKey: TRANSACTIONS_KEY });
    },
  });
}

export function useSalvage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemInstanceId: string) =>
      apiSend<SalvageResponse>(
        'POST',
        '/api/v1/inventory/salvage',
        { itemInstanceId, idempotencyKey: newKey() },
        (raw) => salvageResponseSchema.parse(raw),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
    },
  });
}

export function useSellback(shopId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { itemSlug: string; quantity: number }) =>
      apiSend<SellbackResponse>(
        'POST',
        `/api/v1/npc-shops/${shopId}/sales`,
        { ...input, idempotencyKey: newKey() },
        (raw) => sellbackResponseSchema.parse(raw),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shopDetailKey(shopId) });
      void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
      void queryClient.invalidateQueries({ queryKey: CURRENCY_KEY });
      void queryClient.invalidateQueries({ queryKey: TRANSACTIONS_KEY });
    },
  });
}
