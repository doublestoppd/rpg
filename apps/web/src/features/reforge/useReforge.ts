import {
  type ReforgeQuote,
  reforgeQuoteSchema,
  type ReforgeResult,
  reforgeResultSchema,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '../../lib/api';
import { INVENTORY_KEY } from '../inventory/useInventory';

const CHARACTER_KEYS = [['character', 'me'] as const, ['character', 'stats'] as const];

export function useReforgeQuote(itemInstanceId: string | null) {
  return useQuery<ReforgeQuote>({
    queryKey: ['reforge', 'quote', itemInstanceId],
    queryFn: () =>
      apiGet(`/api/v1/reforge/quote?itemInstanceId=${itemInstanceId!}`, (raw) =>
        reforgeQuoteSchema.parse(raw),
      ),
    enabled: Boolean(itemInstanceId),
    staleTime: 0,
  });
}

export function useReforge() {
  const queryClient = useQueryClient();
  return useMutation<ReforgeResult, Error, string>({
    mutationFn: (itemInstanceId: string) =>
      apiSend(
        'POST',
        '/api/v1/reforge',
        { itemInstanceId, idempotencyKey: crypto.randomUUID().replaceAll('-', '') },
        (raw) => reforgeResultSchema.parse(raw),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['reforge'] });
      for (const key of CHARACTER_KEYS) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
