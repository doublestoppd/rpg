import { type CharacterBuildResponse, characterBuildResponseSchema } from '@rpg/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { apiGet, apiSend } from '../../lib/api';

export const BUILD_KEY = ['builds', 'me'] as const;

export function useBuild(enabled = true): UseQueryResult<CharacterBuildResponse> {
  return useQuery<CharacterBuildResponse>({
    queryKey: BUILD_KEY,
    queryFn: () => apiGet('/api/v1/builds/me', (raw) => characterBuildResponseSchema.parse(raw)),
    enabled,
  });
}

export function useSetLoadout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (abilitySlugs: string[]) =>
      apiSend('PUT', '/api/v1/builds/me/loadout', { abilitySlugs }, (raw) =>
        characterBuildResponseSchema.parse(raw),
      ),
    onSuccess: (data) => qc.setQueryData(BUILD_KEY, data),
  });
}

export function useChooseTalent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { tier: number; talentSlug: string | null }) =>
      apiSend('PUT', '/api/v1/builds/me/talents', input, (raw) =>
        characterBuildResponseSchema.parse(raw),
      ),
    onSuccess: (data) => qc.setQueryData(BUILD_KEY, data),
  });
}

export function useRespec() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiSend('POST', '/api/v1/builds/me/respec', { idempotencyKey: crypto.randomUUID() }, (raw) =>
        characterBuildResponseSchema.parse(raw),
      ),
    onSuccess: (data) => {
      qc.setQueryData(BUILD_KEY, data);
      void qc.invalidateQueries({ queryKey: ['currency'] });
    },
  });
}
