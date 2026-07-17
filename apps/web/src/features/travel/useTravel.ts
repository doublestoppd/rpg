import {
  type TravelStartRequest,
  travelStateSchema,
  type TravelStatusResponse,
  travelStatusResponseSchema,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '../../lib/api';
import { DESTINATIONS_KEY, FEATURES_KEY, LOCATION_KEY } from '../location/useLocation';

export const TRAVEL_STATUS_KEY = ['travel', 'status'] as const;

export function useTravelStatus(enabled = true) {
  return useQuery<TravelStatusResponse>({
    queryKey: TRAVEL_STATUS_KEY,
    queryFn: () => apiGet('/api/v1/travel/status', (raw) => travelStatusResponseSchema.parse(raw)),
    enabled,
    // While traveling, keep the countdown honest; the server finalizes lazily.
    refetchInterval: (query) => (query.state.data?.active ? 3000 : false),
    staleTime: 1000,
  });
}

export function useStartTravel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TravelStartRequest) =>
      apiSend('POST', '/api/v1/travel/start', input, (raw) => travelStateSchema.parse(raw)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TRAVEL_STATUS_KEY });
      void queryClient.invalidateQueries({ queryKey: LOCATION_KEY });
      void queryClient.invalidateQueries({ queryKey: FEATURES_KEY });
      void queryClient.invalidateQueries({ queryKey: DESTINATIONS_KEY });
    },
  });
}

/** Invalidate location-dependent queries once an arrival is observed. */
export function useInvalidateAfterArrival() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: TRAVEL_STATUS_KEY });
    void queryClient.invalidateQueries({ queryKey: LOCATION_KEY });
    void queryClient.invalidateQueries({ queryKey: FEATURES_KEY });
    void queryClient.invalidateQueries({ queryKey: DESTINATIONS_KEY });
  };
}
