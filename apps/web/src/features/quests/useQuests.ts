import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  claimQuestResponseSchema,
  questsResponseSchema,
  questViewSchema,
  type ClaimQuestResponse,
  type QuestsResponse,
  type QuestView,
} from '@rpg/shared';

import { apiGet, apiSend } from '../../lib/api';
import { CURRENCY_KEY, TRANSACTIONS_KEY } from '../currency/useCurrency';
import { INVENTORY_KEY } from '../inventory/useInventory';

export const QUESTS_KEY = ['quests'] as const;

export function useQuests(enabled = true) {
  return useQuery<QuestsResponse>({
    queryKey: QUESTS_KEY,
    queryFn: () => apiGet('/api/v1/quests', (raw) => questsResponseSchema.parse(raw)),
    enabled,
    staleTime: 5_000,
  });
}

export function useAcceptQuest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (questId: string) =>
      apiSend('POST', `/api/v1/quests/${questId}/accept`, undefined, (raw) =>
        questViewSchema.parse(raw),
      ) as Promise<QuestView>,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUESTS_KEY }),
  });
}

export function useClaimQuest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (questId: string) =>
      apiSend('POST', `/api/v1/quests/${questId}/claim`, undefined, (raw) =>
        claimQuestResponseSchema.parse(raw),
      ) as Promise<ClaimQuestResponse>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUESTS_KEY });
      void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
      void queryClient.invalidateQueries({ queryKey: CURRENCY_KEY });
      void queryClient.invalidateQueries({ queryKey: TRANSACTIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['character', 'me'] });
    },
  });
}
