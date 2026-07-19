import {
  type ChatBlocksResponse,
  chatBlocksResponseSchema,
  type ChatChannelsResponse,
  chatChannelsResponseSchema,
  type ChatMessagesResponse,
  chatMessagesResponseSchema,
  type ChatReportReason,
  type CreateChatReportRequest,
  okResponseSchema,
  type SendChatMessageResponse,
  sendChatMessageResponseSchema,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { apiGet, apiSend } from '../../lib/api';

export const CHAT_CHANNELS_KEY = ['chat', 'channels'] as const;
export const chatMessagesKey = (channelId: string) => ['chat', 'messages', channelId] as const;
export const CHAT_BLOCKS_KEY = ['chat', 'blocks'] as const;

/** Polling interval — the guaranteed fallback when WebSockets fail. */
const CHANNELS_POLL_MS = 15_000;
const MESSAGES_POLL_MS = 10_000;

export function useChatChannels(enabled = true): UseQueryResult<ChatChannelsResponse> {
  return useQuery<ChatChannelsResponse>({
    queryKey: CHAT_CHANNELS_KEY,
    queryFn: () => apiGet('/api/v1/chat/channels', (raw) => chatChannelsResponseSchema.parse(raw)),
    enabled,
    refetchInterval: CHANNELS_POLL_MS,
    staleTime: 5_000,
  });
}

/**
 * The newest page of a channel's history. Polling every 10s is the complete
 * fallback: the live socket only makes refetches arrive sooner. The list is
 * newest-first from the API; the UI reverses it for display.
 */
export function useChatMessages(channelId: string | null): UseQueryResult<ChatMessagesResponse> {
  return useQuery<ChatMessagesResponse>({
    queryKey: chatMessagesKey(channelId ?? 'none'),
    queryFn: () =>
      apiGet(`/api/v1/chat/channels/${channelId}/messages?limit=50`, (raw) =>
        chatMessagesResponseSchema.parse(raw),
      ),
    enabled: Boolean(channelId),
    refetchInterval: MESSAGES_POLL_MS,
    staleTime: 2_000,
  });
}

export function useSendChatMessage(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation<SendChatMessageResponse, Error, { body: string; idempotencyKey: string }>({
    mutationFn: (input) =>
      apiSend('POST', `/api/v1/chat/channels/${channelId}/messages`, input, (raw) =>
        sendChatMessageResponseSchema.parse(raw),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatMessagesKey(channelId) });
      void queryClient.invalidateQueries({ queryKey: CHAT_CHANNELS_KEY });
    },
  });
}

export function useMarkChatRead(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      apiSend('POST', `/api/v1/chat/channels/${channelId}/read`, { messageId }, (raw) =>
        okResponseSchema.parse(raw),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: CHAT_CHANNELS_KEY }),
  });
}

export function useChatBlocks(enabled = true): UseQueryResult<ChatBlocksResponse> {
  return useQuery<ChatBlocksResponse>({
    queryKey: CHAT_BLOCKS_KEY,
    queryFn: () => apiGet('/api/v1/chat/blocks', (raw) => chatBlocksResponseSchema.parse(raw)),
    enabled,
    staleTime: 30_000,
  });
}

export function useBlockCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (characterId: string) =>
      apiSend('PUT', `/api/v1/chat/blocks/${characterId}`, undefined, (raw) =>
        okResponseSchema.parse(raw),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHAT_BLOCKS_KEY });
      // Blocked authors vanish from cached and newly fetched history at once.
      void queryClient.invalidateQueries({ queryKey: ['chat', 'messages'] });
      void queryClient.invalidateQueries({ queryKey: CHAT_CHANNELS_KEY });
    },
  });
}

export function useUnblockCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (characterId: string) =>
      apiSend('DELETE', `/api/v1/chat/blocks/${characterId}`, undefined, (raw) =>
        okResponseSchema.parse(raw),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHAT_BLOCKS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['chat', 'messages'] });
    },
  });
}

export function useReportChatMessage() {
  return useMutation<
    unknown,
    Error,
    { messageId: string; reason: ChatReportReason; details?: string }
  >({
    mutationFn: ({ messageId, reason, details }) => {
      const body: CreateChatReportRequest = details ? { reason, details } : { reason };
      return apiSend('POST', `/api/v1/chat/messages/${messageId}/reports`, body, (raw) =>
        okResponseSchema.parse(raw),
      );
    },
  });
}
