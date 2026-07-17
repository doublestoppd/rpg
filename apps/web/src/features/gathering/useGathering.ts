import {
  claimGatheringResponseSchema,
  type GatheringActionsResponse,
  gatheringActionsResponseSchema,
  gatheringRunSchema,
  type GatheringStatusResponse,
  gatheringStatusResponseSchema,
  type StartGatheringRequest,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '../../lib/api';
import { INVENTORY_KEY } from '../inventory/useInventory';

export const GATHERING_ACTIONS_KEY = ['gathering', 'actions'] as const;
export const GATHERING_STATUS_KEY = ['gathering', 'status'] as const;

function invalidateAfterGathering(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: GATHERING_STATUS_KEY });
  void queryClient.invalidateQueries({ queryKey: GATHERING_ACTIONS_KEY });
  void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
  void queryClient.invalidateQueries({ queryKey: ['character', 'me'] });
}

export function useGatheringActions(enabled = true) {
  return useQuery<GatheringActionsResponse>({
    queryKey: GATHERING_ACTIONS_KEY,
    queryFn: () =>
      apiGet('/api/v1/gathering/actions', (raw) => gatheringActionsResponseSchema.parse(raw)),
    enabled,
    staleTime: 10_000,
  });
}

export function useGatheringStatus(enabled = true) {
  return useQuery<GatheringStatusResponse>({
    queryKey: GATHERING_STATUS_KEY,
    queryFn: () =>
      apiGet('/api/v1/gathering/status', (raw) => gatheringStatusResponseSchema.parse(raw)),
    enabled,
    // While working, keep the countdown honest; the server finalizes lazily.
    refetchInterval: (query) => (query.state.data?.active ? 2000 : false),
    staleTime: 1000,
  });
}

export function useStartGathering() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartGatheringRequest) =>
      apiSend('POST', '/api/v1/gathering/start', input, (raw) => gatheringRunSchema.parse(raw)),
    onSuccess: () => invalidateAfterGathering(queryClient),
  });
}

export function useClaimGathering() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiSend('POST', '/api/v1/gathering/claim', undefined, (raw) =>
        claimGatheringResponseSchema.parse(raw),
      ),
    onSuccess: () => invalidateAfterGathering(queryClient),
  });
}
