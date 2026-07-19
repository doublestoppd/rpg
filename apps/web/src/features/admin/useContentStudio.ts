import {
  type AdminContentDefinition,
  adminContentDefinitionSchema,
  type AdminContentDiff,
  adminContentDiffSchema,
  type AdminContentPreview,
  adminContentPreviewSchema,
  type AdminContentValidation,
  adminContentValidationSchema,
  type AdminReleaseDetail,
  adminReleaseDetailSchema,
  adminReleaseResponseSchema,
  type AdminWhereUsed,
  adminWhereUsedSchema,
  type ContentReleasesResponse,
  contentReleasesResponseSchema,
} from '@rpg/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { apiGet, apiSend } from '../../lib/api';

export const CONTENT_RELEASES_KEY = ['admin', 'content', 'releases'] as const;

function newKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

const defPath = (releaseId: string, type: string, key: string): string =>
  `/api/v1/admin/content/releases/${releaseId}/definitions/${type}/${encodeURIComponent(key)}`;

export function useContentReleases(enabled = true): UseQueryResult<ContentReleasesResponse> {
  return useQuery<ContentReleasesResponse>({
    queryKey: CONTENT_RELEASES_KEY,
    queryFn: () =>
      apiGet('/api/v1/admin/content/releases', (raw) => contentReleasesResponseSchema.parse(raw)),
    enabled,
    staleTime: 5_000,
  });
}

export function useReleaseDetail(releaseId: string | null): UseQueryResult<AdminReleaseDetail> {
  return useQuery<AdminReleaseDetail>({
    queryKey: ['admin', 'content', 'release', releaseId],
    queryFn: () =>
      apiGet(`/api/v1/admin/content/releases/${releaseId}`, (raw) =>
        adminReleaseDetailSchema.parse(raw),
      ),
    enabled: Boolean(releaseId),
  });
}

export function useReleaseValidation(
  releaseId: string | null,
  enabled: boolean,
): UseQueryResult<AdminContentValidation> {
  return useQuery<AdminContentValidation>({
    queryKey: ['admin', 'content', 'validate', releaseId],
    queryFn: () =>
      apiGet(`/api/v1/admin/content/releases/${releaseId}/validate`, (raw) =>
        adminContentValidationSchema.parse(raw),
      ),
    enabled: Boolean(releaseId) && enabled,
  });
}

export function useReleaseDiff(
  releaseId: string | null,
  enabled: boolean,
): UseQueryResult<AdminContentDiff> {
  return useQuery<AdminContentDiff>({
    queryKey: ['admin', 'content', 'diff', releaseId],
    queryFn: () =>
      apiGet(`/api/v1/admin/content/releases/${releaseId}/diff`, (raw) =>
        adminContentDiffSchema.parse(raw),
      ),
    enabled: Boolean(releaseId) && enabled,
  });
}

export function useDefinition(
  releaseId: string | null,
  type: string | null,
  key: string | null,
): UseQueryResult<AdminContentDefinition> {
  return useQuery<AdminContentDefinition>({
    queryKey: ['admin', 'content', 'def', releaseId, type, key],
    queryFn: () =>
      apiGet(defPath(releaseId!, type!, key!), (raw) => adminContentDefinitionSchema.parse(raw)),
    enabled: Boolean(releaseId && type && key),
  });
}

export function useWhereUsed(
  releaseId: string | null,
  type: string | null,
  key: string | null,
): UseQueryResult<AdminWhereUsed> {
  return useQuery<AdminWhereUsed>({
    queryKey: ['admin', 'content', 'where-used', releaseId, type, key],
    queryFn: () =>
      apiGet(`${defPath(releaseId!, type!, key!)}/where-used`, (raw) =>
        adminWhereUsedSchema.parse(raw),
      ),
    enabled: Boolean(releaseId && type && key),
  });
}

export function usePreview(
  releaseId: string | null,
  type: string | null,
  key: string | null,
): UseQueryResult<AdminContentPreview> {
  return useQuery<AdminContentPreview>({
    queryKey: ['admin', 'content', 'preview', releaseId, type, key],
    queryFn: () =>
      apiGet(`${defPath(releaseId!, type!, key!)}/preview`, (raw) =>
        adminContentPreviewSchema.parse(raw),
      ),
    enabled: Boolean(releaseId && type && key),
  });
}

export function useCreateDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; fromReleaseId?: string }) =>
      apiSend('POST', '/api/v1/admin/content/releases', input, (raw) =>
        adminReleaseResponseSchema.parse(raw),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CONTENT_RELEASES_KEY }),
  });
}

export function useUpsertDefinition(releaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: string; key: string; payload: Record<string, unknown> }) =>
      apiSend('PUT', defPath(releaseId, input.type, input.key), { payload: input.payload }, (raw) =>
        adminContentDefinitionSchema.parse(raw),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'content', 'release', releaseId] });
      void qc.invalidateQueries({ queryKey: ['admin', 'content', 'validate', releaseId] });
      void qc.invalidateQueries({ queryKey: ['admin', 'content', 'diff', releaseId] });
    },
  });
}

export function useRemoveDefinition(releaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: string; key: string }) =>
      apiSend(
        'DELETE',
        defPath(releaseId, input.type, input.key),
        undefined,
        (raw) => raw as { removed: boolean },
      ),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['admin', 'content', 'release', releaseId] }),
  });
}

export function usePublishRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { releaseId: string; reason: string; expectedVersion: number }) =>
      apiSend(
        'POST',
        `/api/v1/admin/content/releases/${input.releaseId}/publish`,
        {
          reason: input.reason,
          expectedVersion: input.expectedVersion,
          idempotencyKey: newKey('publish'),
        },
        (raw) => adminReleaseResponseSchema.parse(raw),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'content'] }),
  });
}

export function useRetireRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { releaseId: string; reason: string }) =>
      apiSend(
        'POST',
        `/api/v1/admin/content/releases/${input.releaseId}/retire`,
        { reason: input.reason, idempotencyKey: newKey('retire') },
        (raw) => adminReleaseResponseSchema.parse(raw),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'content'] }),
  });
}
