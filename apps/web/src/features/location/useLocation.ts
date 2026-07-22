import {
  type CurrentLocationResponse,
  currentLocationResponseSchema,
  type LocationFeaturesResponse,
  locationFeaturesResponseSchema,
  type TravelDestinationsResponse,
  travelDestinationsResponseSchema,
  type WorldMapResponse,
  worldMapResponseSchema,
} from '@rpg/shared';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '../../lib/api';

export const LOCATION_KEY = ['location', 'current'] as const;
export const FEATURES_KEY = ['location', 'features'] as const;
export const DESTINATIONS_KEY = ['travel', 'destinations'] as const;
export const WORLD_MAP_KEY = ['world', 'map'] as const;

export function useCurrentLocation(enabled = true) {
  return useQuery<CurrentLocationResponse>({
    queryKey: LOCATION_KEY,
    queryFn: () =>
      apiGet('/api/v1/locations/current', (raw) => currentLocationResponseSchema.parse(raw)),
    enabled,
    staleTime: 10_000,
  });
}

export function useLocationFeatures(enabled = true) {
  return useQuery<LocationFeaturesResponse>({
    queryKey: FEATURES_KEY,
    queryFn: () =>
      apiGet('/api/v1/locations/current/features', (raw) =>
        locationFeaturesResponseSchema.parse(raw),
      ),
    enabled,
    staleTime: 10_000,
  });
}

export function useTravelDestinations(enabled = true) {
  return useQuery<TravelDestinationsResponse>({
    queryKey: DESTINATIONS_KEY,
    queryFn: () =>
      apiGet('/api/v1/travel/destinations', (raw) => travelDestinationsResponseSchema.parse(raw)),
    enabled,
    staleTime: 10_000,
  });
}

export function useWorldMap(enabled = true) {
  return useQuery<WorldMapResponse>({
    queryKey: WORLD_MAP_KEY,
    queryFn: () => apiGet('/api/v1/world/map', (raw) => worldMapResponseSchema.parse(raw)),
    enabled,
    staleTime: 30_000,
  });
}
