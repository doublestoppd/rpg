import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  characterClassListSchema,
  characterResponseSchema,
  characterStatsResponseSchema,
  type CharacterClassInfo,
  type CharacterResponse,
  type CharacterStatsResponse,
  type CreateCharacterRequest,
} from '@rpg/shared';

import { apiGet, apiSend, ApiRequestError } from '../../lib/api';

const CHARACTER_KEY = ['character', 'me'] as const;
const STATS_KEY = ['character', 'stats'] as const;
const CLASSES_KEY = ['character', 'classes'] as const;

/** The account character, or null when none has been created yet. */
export function useCharacter(enabled = true) {
  return useQuery<CharacterResponse | null>({
    queryKey: CHARACTER_KEY,
    queryFn: async () => {
      try {
        return await apiGet('/api/v1/characters/me', (raw) => characterResponseSchema.parse(raw));
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) return null;
        throw error;
      }
    },
    enabled,
    staleTime: 10_000,
  });
}

export function useCharacterStats(enabled = true) {
  return useQuery<CharacterStatsResponse>({
    queryKey: STATS_KEY,
    queryFn: () =>
      apiGet('/api/v1/characters/me/stats', (raw) => characterStatsResponseSchema.parse(raw)),
    enabled,
    staleTime: 10_000,
  });
}

export function useCharacterClasses() {
  return useQuery<CharacterClassInfo[]>({
    queryKey: CLASSES_KEY,
    queryFn: () =>
      apiGet('/api/v1/characters/classes', (raw) => characterClassListSchema.parse(raw)),
    staleTime: Infinity,
  });
}

export function useCreateCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCharacterRequest) =>
      apiSend('POST', '/api/v1/characters', input, (raw) => characterResponseSchema.parse(raw)),
    onSuccess: (character) => {
      queryClient.setQueryData(CHARACTER_KEY, character);
      void queryClient.invalidateQueries({ queryKey: STATS_KEY });
    },
  });
}
