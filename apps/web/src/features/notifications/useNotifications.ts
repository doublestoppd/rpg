import {
  liveSocketEventSchema,
  type NotificationsResponse,
  notificationsResponseSchema,
  okResponseSchema,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { apiGet, apiSend } from '../../lib/api';
import { CHAT_CHANNELS_KEY, chatMessagesKey } from '../chat/useChat';
import { setLiveSocketConnected } from './liveSocketStatus';

export const NOTIFICATIONS_KEY = ['notifications'] as const;

/** Polling interval — the guaranteed fallback when WebSockets fail. */
const POLL_MS = 15_000;

export function useNotifications(enabled = true) {
  return useQuery<NotificationsResponse>({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => apiGet('/api/v1/notifications', (raw) => notificationsResponseSchema.parse(raw)),
    enabled,
    refetchInterval: POLL_MS,
    staleTime: 5_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      apiSend('POST', `/api/v1/notifications/${notificationId}/read`, undefined, (raw) =>
        okResponseSchema.parse(raw),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiSend('POST', '/api/v1/notifications/read-all', undefined, (raw) =>
        okResponseSchema.parse(raw),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

/**
 * Optional live enhancement: one authenticated WebSocket (the shared Phase 15
 * transport) whose only job is to trigger refetches faster than the poll. It
 * carries both notification sync nudges and chat.message.created
 * invalidations. Failures are silent — polling keeps working, and the
 * persisted rows remain the source of truth.
 */
export function useLiveSocket(enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 2000;

    const connect = () => {
      if (closed) return;
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      try {
        socket = new WebSocket(`${scheme}://${window.location.host}/api/v1/notifications/ws`);
      } catch {
        return; // no socket support: polling covers everything
      }
      socket.onopen = () => {
        retryDelay = 2000;
        setLiveSocketConnected(true);
      };
      socket.onmessage = (event) => {
        const parsed = liveSocketEventSchema.safeParse(JSON.parse(String(event.data)));
        if (!parsed.success) return; // unknown message: the poll catches up
        if (parsed.data.type === 'sync') {
          void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
        } else {
          // chat.message.created: refetch the affected channel and the
          // channel list (unread counts). Content always comes over REST.
          void queryClient.invalidateQueries({
            queryKey: chatMessagesKey(parsed.data.channelId),
          });
          void queryClient.invalidateQueries({ queryKey: CHAT_CHANNELS_KEY });
        }
      };
      socket.onclose = () => {
        setLiveSocketConnected(false);
        if (closed) return;
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60_000);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      closed = true;
      setLiveSocketConnected(false);
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [enabled, queryClient]);
}
