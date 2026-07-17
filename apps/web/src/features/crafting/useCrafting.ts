import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  claimCraftingResponseSchema,
  craftingRecipesResponseSchema,
  craftingRunSchema,
  craftingStatusResponseSchema,
  type CraftingRecipesResponse,
  type CraftingStatusResponse,
  type StartCraftingRequest,
} from '@rpg/shared';

import { apiGet, apiSend } from '../../lib/api';
import { CURRENCY_KEY, TRANSACTIONS_KEY } from '../currency/useCurrency';
import { INVENTORY_KEY } from '../inventory/useInventory';

export const CRAFTING_RECIPES_KEY = ['crafting', 'recipes'] as const;
export const CRAFTING_STATUS_KEY = ['crafting', 'status'] as const;

function invalidateAfterCrafting(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: CRAFTING_STATUS_KEY });
  void queryClient.invalidateQueries({ queryKey: CRAFTING_RECIPES_KEY });
  void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
  void queryClient.invalidateQueries({ queryKey: CURRENCY_KEY });
  void queryClient.invalidateQueries({ queryKey: TRANSACTIONS_KEY });
  void queryClient.invalidateQueries({ queryKey: ['character', 'me'] });
}

export function useCraftingRecipes(enabled = true) {
  return useQuery<CraftingRecipesResponse>({
    queryKey: CRAFTING_RECIPES_KEY,
    queryFn: () =>
      apiGet('/api/v1/crafting/recipes', (raw) => craftingRecipesResponseSchema.parse(raw)),
    enabled,
    staleTime: 10_000,
  });
}

export function useCraftingStatus(enabled = true) {
  return useQuery<CraftingStatusResponse>({
    queryKey: CRAFTING_STATUS_KEY,
    queryFn: () =>
      apiGet('/api/v1/crafting/status', (raw) => craftingStatusResponseSchema.parse(raw)),
    enabled,
    // While the forge is working, keep the countdown honest.
    refetchInterval: (query) => (query.state.data?.active ? 2000 : false),
    staleTime: 1000,
  });
}

export function useStartCrafting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartCraftingRequest) =>
      apiSend('POST', '/api/v1/crafting/start', input, (raw) => craftingRunSchema.parse(raw)),
    onSuccess: () => invalidateAfterCrafting(queryClient),
  });
}

export function useClaimCrafting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiSend('POST', '/api/v1/crafting/claim', undefined, (raw) =>
        claimCraftingResponseSchema.parse(raw),
      ),
    onSuccess: () => invalidateAfterCrafting(queryClient),
  });
}
