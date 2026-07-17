import {
  type NotificationsResponse,
  notificationsResponseSchema,
  notificationSyncMessageSchema,
  okResponseSchema,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { apiGet, apiSend } from '../../lib/api';

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
 * Optional live enhancement: an authenticated WebSocket whose only job is
 * to trigger refetches faster than the poll. Failures are silent — polling
 * keeps working, and stored notifications remain the source of truth.
 */
export function useNotificationSocket(enabled: boolean) {
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
      };
      socket.onmessage = (event) => {
        try {
          notificationSyncMessageSchema.parse(JSON.parse(String(event.data)));
          void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
        } catch {
          // Unknown message: ignore; the poll will catch up.
        }
      };
      socket.onclose = () => {
        if (closed) return;
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60_000);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [enabled, queryClient]);
}
