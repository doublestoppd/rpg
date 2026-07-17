import {
  type CurrencyBalanceResponse,
  currencyBalanceResponseSchema,
  type CurrencyTransactionsResponse,
  currencyTransactionsResponseSchema,
  type InnRestRequest,
  innRestResponseSchema,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '../../lib/api';

export const CURRENCY_KEY = ['currency', 'balance'] as const;
export const TRANSACTIONS_KEY = ['currency', 'transactions'] as const;

export function useCurrency(enabled = true) {
  return useQuery<CurrencyBalanceResponse>({
    queryKey: CURRENCY_KEY,
    queryFn: () => apiGet('/api/v1/currency', (raw) => currencyBalanceResponseSchema.parse(raw)),
    enabled,
    staleTime: 5_000,
  });
}

export function useCurrencyTransactions(enabled = true) {
  return useQuery<CurrencyTransactionsResponse>({
    queryKey: TRANSACTIONS_KEY,
    queryFn: () =>
      apiGet('/api/v1/currency/transactions', (raw) =>
        currencyTransactionsResponseSchema.parse(raw),
      ),
    enabled,
    staleTime: 5_000,
  });
}

export function useInnRest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InnRestRequest) =>
      apiSend('POST', '/api/v1/locations/current/inn/rest', input, (raw) =>
        innRestResponseSchema.parse(raw),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CURRENCY_KEY });
      void queryClient.invalidateQueries({ queryKey: TRANSACTIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['character', 'me'] });
      void queryClient.invalidateQueries({ queryKey: ['character', 'stats'] });
    },
  });
}
