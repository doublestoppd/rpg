import {
  type ChooseRequest,
  type NpcInteractionResponse,
  npcInteractionResponseSchema,
  type SceneResponse,
  sceneResponseSchema,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '../../lib/api';

export const SCENE_KEY = ['location', 'scene'] as const;
export const INTERACTION_KEY = (id: string) => ['npc-interaction', id] as const;

/**
 * The coherent current-scene read model: location, time segment, atmosphere,
 * active world events, present NPCs, features, and a bounded activity summary,
 * composed server-side under a single `now`. Refetched periodically so the
 * scene can reflect a segment change or a newly-active event without a reload.
 */
export function useScene(enabled = true) {
  return useQuery<SceneResponse>({
    queryKey: SCENE_KEY,
    queryFn: () =>
      apiGet('/api/v1/locations/current/scene', (raw) => sceneResponseSchema.parse(raw)),
    enabled,
    // The segment/event/atmosphere only change when the world cycle turns, so a
    // gentle poll keeps the scene fresh without hammering the read model.
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function useInteraction(interactionId: string | null) {
  return useQuery<NpcInteractionResponse>({
    queryKey: INTERACTION_KEY(interactionId ?? 'none'),
    queryFn: () =>
      apiGet(`/api/v1/npc-interactions/${interactionId}`, (raw) =>
        npcInteractionResponseSchema.parse(raw),
      ),
    enabled: Boolean(interactionId),
    staleTime: 2000,
  });
}

/** Start (or idempotently resume) a conversation with a present NPC. */
export function useStartInteraction(npcKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) =>
      apiSend('POST', `/api/v1/npcs/${npcKey}/interactions`, { idempotencyKey }, (raw) =>
        npcInteractionResponseSchema.parse(raw),
      ),
    onSuccess: (interaction) => {
      queryClient.setQueryData(INTERACTION_KEY(interaction.interactionId), interaction);
    },
  });
}

/**
 * Resolve one dialogue choice. Version-checked (a stale expectedVersion is 409)
 * and idempotent (a replayed key returns the original outcome). Effects that
 * touch gold/quests/flags may have changed those read models, so invalidate the
 * broadly-affected caches on success.
 */
export function useChooseChoice(interactionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChooseRequest) =>
      apiSend('POST', `/api/v1/npc-interactions/${interactionId}/choices`, input, (raw) =>
        npcInteractionResponseSchema.parse(raw),
      ),
    onSuccess: (interaction) => {
      queryClient.setQueryData(INTERACTION_KEY(interaction.interactionId), interaction);
      void queryClient.invalidateQueries({ queryKey: ['currency'] });
      void queryClient.invalidateQueries({ queryKey: ['quests'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useCloseInteraction(interactionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiSend('POST', `/api/v1/npc-interactions/${interactionId}/close`, {}, (raw) =>
        npcInteractionResponseSchema.parse(raw),
      ),
    onSuccess: (interaction) => {
      queryClient.setQueryData(INTERACTION_KEY(interaction.interactionId), interaction);
    },
  });
}
