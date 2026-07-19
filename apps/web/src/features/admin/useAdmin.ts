import {
  type AdminCharacterListResponse,
  adminCharacterListResponseSchema,
  type AdminCharacterOverviewResponse,
  adminCharacterOverviewResponseSchema,
  type AdminChatReportsResponse,
  adminChatReportsResponseSchema,
  type AdminEconomyMetricsResponse,
  adminEconomyMetricsResponseSchema,
  type AdminGoldAdjustmentResponse,
  adminGoldAdjustmentResponseSchema,
  type AdminItemActionResponse,
  adminItemActionResponseSchema,
  type AdminModerationResponse,
  adminModerationResponseSchema,
  adminReauthResponseSchema,
  type AdminRestrictionResponse,
  adminRestrictionResponseSchema,
  type AdminSessionResponse,
  adminSessionResponseSchema,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { apiGet, apiSend } from '../../lib/api';

export const ADMIN_SESSION_KEY = ['admin', 'session'] as const;
export const ADMIN_REPORTS_KEY = ['admin', 'reports'] as const;

function newKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function useAdminSession(enabled = true): UseQueryResult<AdminSessionResponse> {
  return useQuery<AdminSessionResponse>({
    queryKey: ADMIN_SESSION_KEY,
    queryFn: () => apiGet('/api/v1/admin/session', (raw) => adminSessionResponseSchema.parse(raw)),
    enabled,
    staleTime: 5_000,
  });
}

export function useAdminReauth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      apiSend('POST', '/api/v1/admin/reauth', { password }, (raw) =>
        adminReauthResponseSchema.parse(raw),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ADMIN_SESSION_KEY }),
  });
}

export function useAdminCharacterSearch(query: string): UseQueryResult<AdminCharacterListResponse> {
  return useQuery<AdminCharacterListResponse>({
    queryKey: ['admin', 'characters', query],
    queryFn: () =>
      apiGet(
        `/api/v1/admin/characters${query ? `?query=${encodeURIComponent(query)}` : ''}`,
        (raw) => adminCharacterListResponseSchema.parse(raw),
      ),
    staleTime: 5_000,
  });
}

export function useAdminOverview(
  characterId: string | null,
): UseQueryResult<AdminCharacterOverviewResponse> {
  return useQuery<AdminCharacterOverviewResponse>({
    queryKey: ['admin', 'overview', characterId],
    queryFn: () =>
      apiGet(`/api/v1/admin/characters/${characterId}/overview`, (raw) =>
        adminCharacterOverviewResponseSchema.parse(raw),
      ),
    enabled: Boolean(characterId),
  });
}

export function useAdminGoldAdjust(characterId: string) {
  const queryClient = useQueryClient();
  return useMutation<AdminGoldAdjustmentResponse, Error, { amount: string; reason: string }>({
    mutationFn: ({ amount, reason }) =>
      apiSend(
        'POST',
        `/api/v1/admin/characters/${characterId}/gold-adjustments`,
        { amount, reason, idempotencyKey: newKey('gold') },
        (raw) => adminGoldAdjustmentResponseSchema.parse(raw),
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['admin', 'overview', characterId] }),
  });
}

export function useAdminItemGrant(characterId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    AdminItemActionResponse,
    Error,
    { itemSlug: string; quantity: number; reason: string }
  >({
    mutationFn: (input) =>
      apiSend(
        'POST',
        `/api/v1/admin/characters/${characterId}/item-grants`,
        { ...input, idempotencyKey: newKey('grant') },
        (raw) => adminItemActionResponseSchema.parse(raw),
      ),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['admin', 'overview', characterId] }),
  });
}

export function useAdminEconomyMetrics(
  hoursBack: number,
  enabled: boolean,
): UseQueryResult<AdminEconomyMetricsResponse> {
  return useQuery<AdminEconomyMetricsResponse>({
    queryKey: ['admin', 'metrics', hoursBack],
    // The window is computed inside queryFn (outside render) so the query key
    // stays stable and render remains pure.
    queryFn: () => {
      const now = Date.now();
      const start = new Date(now - hoursBack * 60 * 60 * 1000).toISOString();
      const end = new Date(now).toISOString();
      return apiGet(
        `/api/v1/admin/metrics/economy?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        (raw) => adminEconomyMetricsResponseSchema.parse(raw),
      );
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useAdminReports(status: string): UseQueryResult<AdminChatReportsResponse> {
  return useQuery<AdminChatReportsResponse>({
    queryKey: [...ADMIN_REPORTS_KEY, status],
    queryFn: () =>
      apiGet(`/api/v1/admin/chat/reports${status ? `?status=${status}` : ''}`, (raw) =>
        adminChatReportsResponseSchema.parse(raw),
      ),
    staleTime: 5_000,
  });
}

export function useAdminRedactMessage() {
  const queryClient = useQueryClient();
  return useMutation<AdminModerationResponse, Error, { messageId: string; reason: string }>({
    mutationFn: ({ messageId, reason }) =>
      apiSend(
        'POST',
        `/api/v1/admin/chat/messages/${messageId}/redact`,
        { reason, idempotencyKey: newKey('redact') },
        (raw) => adminModerationResponseSchema.parse(raw),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ADMIN_REPORTS_KEY }),
  });
}

export function useAdminResolveReport() {
  const queryClient = useQueryClient();
  return useMutation<
    AdminModerationResponse,
    Error,
    { reportId: string; resolution: 'RESOLVED' | 'DISMISSED'; reason: string }
  >({
    mutationFn: ({ reportId, resolution, reason }) =>
      apiSend(
        'POST',
        `/api/v1/admin/chat/reports/${reportId}/resolve`,
        { resolution, reason, idempotencyKey: newKey('resolve') },
        (raw) => adminModerationResponseSchema.parse(raw),
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ADMIN_REPORTS_KEY }),
  });
}

export function useAdminRestrict() {
  return useMutation<
    AdminRestrictionResponse,
    Error,
    { characterId: string; reason: string; expiresAt?: string }
  >({
    mutationFn: ({ characterId, reason, expiresAt }) =>
      apiSend(
        'POST',
        '/api/v1/admin/chat/restrictions',
        {
          characterId,
          reason,
          ...(expiresAt ? { expiresAt } : {}),
          idempotencyKey: newKey('restrict'),
        },
        (raw) => adminRestrictionResponseSchema.parse(raw),
      ),
  });
}
