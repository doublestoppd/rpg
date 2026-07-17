import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  combatViewSchema,
  encountersResponseSchema,
  type CombatCommandRequest,
  type CombatView,
  type EncountersResponse,
  type StartCombatRequest,
} from '@rpg/shared';

import { apiGet, apiSend } from '../../lib/api';
import { CURRENCY_KEY, TRANSACTIONS_KEY } from '../currency/useCurrency';
import { INVENTORY_KEY } from '../inventory/useInventory';

export const ENCOUNTERS_KEY = ['combat', 'encounters'] as const;
export const COMBAT_KEY = (combatId: string) => ['combat', 'view', combatId] as const;

function invalidateAfterCombat(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ENCOUNTERS_KEY });
  void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
  void queryClient.invalidateQueries({ queryKey: CURRENCY_KEY });
  void queryClient.invalidateQueries({ queryKey: TRANSACTIONS_KEY });
  void queryClient.invalidateQueries({ queryKey: ['character', 'me'] });
  void queryClient.invalidateQueries({ queryKey: ['location'] });
}

export function useEncounters(enabled = true) {
  return useQuery<EncountersResponse>({
    queryKey: ENCOUNTERS_KEY,
    queryFn: () =>
      apiGet('/api/v1/combat/encounters', (raw) => encountersResponseSchema.parse(raw)),
    enabled,
    staleTime: 10_000,
  });
}

export function useCombatView(combatId: string | null) {
  return useQuery<CombatView>({
    queryKey: COMBAT_KEY(combatId ?? 'none'),
    queryFn: () => apiGet(`/api/v1/combat/${combatId}`, (raw) => combatViewSchema.parse(raw)),
    enabled: Boolean(combatId),
    staleTime: 2000,
  });
}

export function useStartCombat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartCombatRequest) =>
      apiSend('POST', '/api/v1/combat/start', input, (raw) => combatViewSchema.parse(raw)),
    onSuccess: (view) => {
      queryClient.setQueryData(COMBAT_KEY(view.id), view);
      void queryClient.invalidateQueries({ queryKey: ENCOUNTERS_KEY });
    },
  });
}

export function useCombatCommand(combatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CombatCommandRequest) =>
      apiSend('POST', `/api/v1/combat/${combatId}/commands`, input, (raw) =>
        combatViewSchema.parse(raw),
      ),
    onSuccess: (view) => {
      queryClient.setQueryData(COMBAT_KEY(view.id), view);
      if (view.status !== 'ACTIVE') invalidateAfterCombat(queryClient);
      else void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
    },
  });
}
