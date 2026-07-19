import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestPrisma, truncateAll } from '../test-helpers.js';
import { CLEANUP_DELETABLE_TABLES, runCleanup } from './cleanup.js';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await truncateAll(prisma);
});

async function makeUserWithCharacter() {
  const user = await prisma.user.create({
    data: {
      email: `c-${Math.random().toString(36).slice(2)}@example.com`,
      passwordHash: 'h',
      displayName: `Cl${Math.random().toString(36).slice(2, 8)}`,
    },
  });
  const character = await prisma.character.create({
    data: {
      userId: user.id,
      name: `Ch${Math.random().toString(36).slice(2, 8)}`,
      classSlug: 'vanguard',
      currentHp: 10,
      currentMp: 10,
      stamina: 10,
    },
  });
  return { user, character };
}

describe('data-lifecycle cleanup', () => {
  it('only ever deletes from the allowlisted tables', () => {
    expect(CLEANUP_DELETABLE_TABLES).toEqual(['Session', 'Notification']);
    // Audit/economic evidence tables must never appear in the allowlist.
    for (const forbidden of [
      'CurrencyTransaction',
      'ItemTransfer',
      'ItemDestruction',
      'MarketplaceSale',
      'AdminAuditLog',
      'ChatReport',
      'ChatModerationAction',
    ]) {
      expect(CLEANUP_DELETABLE_TABLES).not.toContain(forbidden);
    }
  });

  it('removes only sufficiently old expired/revoked sessions', async () => {
    const { user } = await makeUserWithCharacter();
    const old = new Date(Date.now() - 40 * 86_400_000);
    const recent = new Date(Date.now() + 86_400_000);
    // Old expired → deleted; active → kept; recently revoked → kept.
    await prisma.session.create({
      data: { userId: user.id, tokenHash: 't-old', csrfToken: 'c', expiresAt: old },
    });
    await prisma.session.create({
      data: { userId: user.id, tokenHash: 't-active', csrfToken: 'c', expiresAt: recent },
    });
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: 't-revoked-recent',
        csrfToken: 'c',
        expiresAt: recent,
        revokedAt: new Date(),
      },
    });

    const result = await runCleanup(prisma, {
      sessionRetentionDays: 30,
      notificationRetentionDays: 30,
      batchSize: 1,
    });
    expect(result.sessionsDeleted).toBe(1);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);
  });

  it('removes only old READ notifications, keeping unread ones regardless of age', async () => {
    const { character } = await makeUserWithCharacter();
    const old = new Date(Date.now() - 40 * 86_400_000);
    await prisma.notification.create({
      data: {
        characterId: character.id,
        type: 'TRAVEL_COMPLETED',
        dedupeKey: 'k-old-read',
        payload: { title: 't', body: 'b' },
        readAt: old,
        createdAt: old,
      },
    });
    await prisma.notification.create({
      data: {
        characterId: character.id,
        type: 'TRAVEL_COMPLETED',
        dedupeKey: 'k-old-unread',
        payload: { title: 't', body: 'b' },
        createdAt: old,
      },
    });

    const result = await runCleanup(prisma, {
      sessionRetentionDays: 30,
      notificationRetentionDays: 30,
    });
    expect(result.notificationsDeleted).toBe(1);
    const remaining = await prisma.notification.findMany({ where: { characterId: character.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.dedupeKey).toBe('k-old-unread');
  });

  it('is idempotent: a second run deletes nothing more', async () => {
    const { user } = await makeUserWithCharacter();
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: 't',
        csrfToken: 'c',
        expiresAt: new Date(Date.now() - 40 * 86_400_000),
      },
    });
    const first = await runCleanup(prisma, {
      sessionRetentionDays: 30,
      notificationRetentionDays: 30,
    });
    expect(first.sessionsDeleted).toBe(1);
    const second = await runCleanup(prisma, {
      sessionRetentionDays: 30,
      notificationRetentionDays: 30,
    });
    expect(second.sessionsDeleted).toBe(0);
  });
});
