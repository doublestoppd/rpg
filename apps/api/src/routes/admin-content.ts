import {
  adminContentDefinitionSchema,
  adminContentDiffSchema,
  adminContentPreviewSchema,
  adminContentValidationSchema,
  adminCreateDraftRequestSchema,
  adminPublishReleaseRequestSchema,
  adminReleaseDetailSchema,
  adminReleaseResponseSchema,
  adminRetireReleaseRequestSchema,
  adminRollbackRequestSchema,
  adminUpsertDefinitionRequestSchema,
  adminWhereUsedSchema,
  contentReleasesResponseSchema,
  contentTypeSchema,
} from '@rpg/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AdminActor } from '../domain/admin/admin-audit.js';
import { adminOnly, isReauthValid, reauthRequired } from '../domain/admin/admin-auth.js';
import type { AdminContentService } from '../domain/admin/admin-content.js';

interface AdminContentRouteOptions {
  contentService: AdminContentService;
  reauthWindowMs: number;
}

/**
 * Admin Content Studio routes (Phase 20). Reads and draft edits require the
 * ADMIN role; publish, retire, and rollback additionally require recent
 * re-authentication because they change what every player sees. Publication
 * carries a mandatory reason, expected version, and idempotency key, and is
 * audited inside the same transaction that applies content to the live tables.
 */
export async function adminContentRoutes(
  app: FastifyInstance,
  opts: AdminContentRouteOptions,
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { contentService, reauthWindowMs } = opts;

  const requireAdmin = async (request: FastifyRequest): Promise<void> => {
    if (!request.currentUser || request.currentUser.role !== 'ADMIN') throw adminOnly();
  };
  const requireReauth = async (request: FastifyRequest): Promise<void> => {
    if (!request.currentUser || request.currentUser.role !== 'ADMIN') throw adminOnly();
    if (!request.currentSession || !isReauthValid(request.currentSession, reauthWindowMs)) {
      throw reauthRequired();
    }
  };
  const actorOf = (request: FastifyRequest): AdminActor => ({
    userId: request.currentUser!.id,
    sessionId: request.currentSession!.id,
    requestId: request.id,
  });

  const releaseParams = z.object({ id: z.uuid() });
  const defParams = z.object({
    id: z.uuid(),
    type: contentTypeSchema,
    key: z.string().min(1).max(200),
  });

  // --- releases ------------------------------------------------------------

  typed.get(
    '/admin/content/releases',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        tags: ['admin'],
        summary: 'List content releases (newest first)',
        response: { 200: contentReleasesResponseSchema },
      },
    },
    async () => contentService.listReleases(),
  );

  typed.post(
    '/admin/content/releases',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Create a draft release from live content or a prior release',
        body: adminCreateDraftRequestSchema,
        response: { 200: adminReleaseResponseSchema },
      },
    },
    async (request) => ({
      release: await contentService.createDraft(actorOf(request), request.body),
    }),
  );

  typed.get(
    '/admin/content/releases/:id',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Release detail with its definition catalog',
        params: releaseParams,
        response: { 200: adminReleaseDetailSchema },
      },
    },
    async (request) => contentService.getRelease(request.params.id),
  );

  typed.get(
    '/admin/content/releases/:id/validate',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Validate a release (errors, warnings, dependency edges)',
        params: releaseParams,
        response: { 200: adminContentValidationSchema },
      },
    },
    async (request) => contentService.validateRelease(request.params.id),
  );

  typed.get(
    '/admin/content/releases/:id/diff',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Diff a release against the current published baseline',
        params: releaseParams,
        response: { 200: adminContentDiffSchema },
      },
    },
    async (request) => contentService.diffRelease(request.params.id),
  );

  // --- definitions ---------------------------------------------------------

  typed.get(
    '/admin/content/releases/:id/definitions/:type/:key',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Fetch a single definition payload for editing',
        params: defParams,
        response: { 200: adminContentDefinitionSchema },
      },
    },
    async (request) =>
      contentService.getDefinition(request.params.id, request.params.type, request.params.key),
  );

  typed.put(
    '/admin/content/releases/:id/definitions/:type/:key',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Create or replace a definition in a draft (domain-validated)',
        params: defParams,
        body: adminUpsertDefinitionRequestSchema,
        response: { 200: adminContentDefinitionSchema },
      },
    },
    async (request) =>
      contentService.upsertDefinition(
        request.params.id,
        request.params.type,
        request.params.key,
        request.body.payload,
      ),
  );

  typed.delete(
    '/admin/content/releases/:id/definitions/:type/:key',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Remove a definition from a draft',
        params: defParams,
        response: { 200: z.object({ removed: z.boolean() }) },
      },
    },
    async (request) =>
      contentService.removeDefinition(request.params.id, request.params.type, request.params.key),
  );

  typed.get(
    '/admin/content/releases/:id/definitions/:type/:key/where-used',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Definitions that reference this one (where used)',
        params: defParams,
        response: { 200: adminWhereUsedSchema },
      },
    },
    async (request) =>
      contentService.whereUsed(request.params.id, request.params.type, request.params.key),
  );

  typed.get(
    '/admin/content/releases/:id/definitions/:type/:key/preview',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        tags: ['admin'],
        summary: 'Preview a definition with its references resolved in the draft',
        params: defParams,
        response: { 200: adminContentPreviewSchema },
      },
    },
    async (request) =>
      contentService.preview(request.params.id, request.params.type, request.params.key),
  );

  // --- lifecycle (reauth) --------------------------------------------------

  typed.post(
    '/admin/content/releases/:id/publish',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Atomically publish a draft to the live tables (audited)',
        params: releaseParams,
        body: adminPublishReleaseRequestSchema,
        response: { 200: adminReleaseResponseSchema },
      },
    },
    async (request) => ({
      release: await contentService.publish(actorOf(request), request.params.id, request.body),
    }),
  );

  typed.post(
    '/admin/content/releases/:id/retire',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Retire a published release (definitions preserved)',
        params: releaseParams,
        body: adminRetireReleaseRequestSchema,
        response: { 200: adminReleaseResponseSchema },
      },
    },
    async (request) => ({
      release: await contentService.retire(actorOf(request), request.params.id, request.body),
    }),
  );

  typed.post(
    '/admin/content/rollback',
    {
      preHandler: [app.requireAuth, requireReauth],
      schema: {
        tags: ['admin'],
        summary: 'Roll a prior release forward as a new published release',
        body: adminRollbackRequestSchema,
        response: { 200: adminReleaseResponseSchema },
      },
    },
    async (request) => ({
      release: await contentService.rollback(actorOf(request), request.body),
    }),
  );
}
