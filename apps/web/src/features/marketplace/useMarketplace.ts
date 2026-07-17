import {
  type CreateListingRequest,
  type CreatePlayerShopRequest,
  type DeliveriesResponse,
  deliveriesResponseSchema,
  type ListingsQuery,
  type MarketplaceListingsResponse,
  marketplaceListingsResponseSchema,
  type MarketSummary,
  marketSummarySchema,
  okResponseSchema,
  type PlayerShopInfo,
  playerShopSchema,
  purchaseListingResponseSchema,
  type RegionsResponse,
  regionsResponseSchema,
  type UpdatePlayerShopRequest,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { apiGet, ApiRequestError, apiSend } from '../../lib/api';
import { CURRENCY_KEY, TRANSACTIONS_KEY } from '../currency/useCurrency';
import { INVENTORY_KEY } from '../inventory/useInventory';

export const MY_SHOP_KEY = ['marketplace', 'my-shop'] as const;
export const REGIONS_KEY = ['marketplace', 'regions'] as const;
export const LISTINGS_KEY = ['marketplace', 'listings'] as const;
export const DELIVERIES_KEY = ['marketplace', 'deliveries'] as const;

function invalidateMarket(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: LISTINGS_KEY });
  void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
  void queryClient.invalidateQueries({ queryKey: CURRENCY_KEY });
  void queryClient.invalidateQueries({ queryKey: TRANSACTIONS_KEY });
  void queryClient.invalidateQueries({ queryKey: DELIVERIES_KEY });
  void queryClient.invalidateQueries({ queryKey: ['character', 'me'] });
}

export function useMyShop(enabled = true) {
  return useQuery<PlayerShopInfo | null>({
    queryKey: MY_SHOP_KEY,
    queryFn: async () => {
      try {
        return await apiGet('/api/v1/player-shops/me', (raw) => playerShopSchema.parse(raw));
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) return null;
        throw error;
      }
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useRegions() {
  return useQuery<RegionsResponse>({
    queryKey: REGIONS_KEY,
    queryFn: () => apiGet('/api/v1/marketplace/regions', (raw) => regionsResponseSchema.parse(raw)),
    staleTime: Infinity,
  });
}

export function useCreateShop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlayerShopRequest) =>
      apiSend('POST', '/api/v1/player-shops', input, (raw) => playerShopSchema.parse(raw)),
    onSuccess: (shop) => queryClient.setQueryData(MY_SHOP_KEY, shop),
  });
}

export function useUpdateShop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePlayerShopRequest) =>
      apiSend('PATCH', '/api/v1/player-shops/me', input, (raw) => playerShopSchema.parse(raw)),
    onSuccess: (shop) => queryClient.setQueryData(MY_SHOP_KEY, shop),
  });
}

export function useListings(query: ListingsQuery, enabled = true) {
  return useQuery<MarketplaceListingsResponse>({
    queryKey: [...LISTINGS_KEY, query],
    queryFn: () => {
      const params = new URLSearchParams();
      if (query.itemSlug) params.set('itemSlug', query.itemSlug);
      if (query.category) params.set('category', query.category);
      if (query.mine) params.set('mine', 'true');
      const qs = params.toString();
      return apiGet(`/api/v1/marketplace/listings${qs ? `?${qs}` : ''}`, (raw) =>
        marketplaceListingsResponseSchema.parse(raw),
      );
    },
    enabled,
    staleTime: 5_000,
  });
}

export function useCreateListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateListingRequest) =>
      apiSend('POST', '/api/v1/marketplace/listings', input, (raw) =>
        z.object({ listingId: z.uuid() }).parse(raw),
      ),
    onSuccess: () => invalidateMarket(queryClient),
  });
}

export function useCancelListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (listingId: string) =>
      apiSend('DELETE', `/api/v1/marketplace/listings/${listingId}`, undefined, (raw) =>
        okResponseSchema.parse(raw),
      ),
    onSuccess: () => invalidateMarket(queryClient),
  });
}

export function usePurchaseListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { listingId: string; idempotencyKey: string }) =>
      apiSend(
        'POST',
        `/api/v1/marketplace/listings/${input.listingId}/purchase`,
        { idempotencyKey: input.idempotencyKey },
        (raw) => purchaseListingResponseSchema.parse(raw),
      ),
    onSuccess: () => invalidateMarket(queryClient),
  });
}

export function useMarketSummary(itemSlug: string | null) {
  return useQuery<MarketSummary>({
    queryKey: ['marketplace', 'summary', itemSlug],
    queryFn: () =>
      apiGet(`/api/v1/marketplace/items/${itemSlug}/summary`, (raw) =>
        marketSummarySchema.parse(raw),
      ),
    enabled: Boolean(itemSlug),
    staleTime: 10_000,
  });
}

export function useDeliveries(enabled = true) {
  return useQuery<DeliveriesResponse>({
    queryKey: DELIVERIES_KEY,
    queryFn: () => apiGet('/api/v1/deliveries', (raw) => deliveriesResponseSchema.parse(raw)),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.deliveries.some((d) => d.status === 'IN_TRANSIT') ? 5000 : false,
    staleTime: 3_000,
  });
}
