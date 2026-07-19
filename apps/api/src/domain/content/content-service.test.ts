import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestPrisma } from '../../test-helpers.js';
import { checksumOf } from './canonical.js';
import { createContentService, RELEASE_1_TITLE } from './content-service.js';

const prisma: PrismaClient = createTestPrisma();
const service = createContentService(prisma);

/**
 * The content registry tables are seed configuration, not gameplay state, so
 * they are not in truncateAll. This suite owns their lifecycle: it clears both
 * registry tables before each test. The trigger only guards UPDATE/DELETE of a
 * PUBLISHED release's definitions, so TRUNCATE ... CASCADE always succeeds.
 */
async function clearRegistry(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ContentDefinition", "ContentRelease" RESTART IDENTITY CASCADE',
  );
}

beforeEach(clearRegistry);

afterAll(async () => {
  await clearRegistry();
  await prisma.$disconnect();
});

describe('content export', () => {
  it('is deterministic: two exports of the same live content are byte-identical', async () => {
    const a = await service.exportCurrent('A');
    const b = await service.exportCurrent('B');
    // Title differs; the definition set does not.
    expect(checksumOf(a.definitions)).toBe(checksumOf(b.definitions));
    expect(a.definitions.length).toBeGreaterThan(0);
  });

  it('exports a bundle that passes every validation rule', async () => {
    const bundle = await service.exportCurrent('current');
    const result = service.validate(bundle);
    expect(result.violations.filter((v) => v.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('Release 1 bootstrap (acceptance test)', () => {
  it('imports all current content as a PUBLISHED Release 1 with no gameplay change', async () => {
    // Snapshot live gameplay tables before the content operation.
    const itemsBefore = await prisma.itemDefinition.count();
    const locationsBefore = await prisma.location.count();
    const exported = await service.exportCurrent('probe');

    const first = await service.ensureRelease1();
    expect(first).toEqual({ created: true, version: 1 });

    const releases = await service.listReleases();
    const release1 = releases.releases.find((r) => r.version === 1)!;
    expect(release1.status).toBe('PUBLISHED');
    expect(release1.title).toBe(RELEASE_1_TITLE);
    // Every exported definition made it into the release.
    expect(release1.definitionCount).toBe(exported.definitions.length);

    // Gameplay tables are untouched — the platform is purely additive.
    expect(await prisma.itemDefinition.count()).toBe(itemsBefore);
    expect(await prisma.location.count()).toBe(locationsBefore);

    // The stored release round-trips to the same content that was exported.
    const stored = await service.getReleaseBundle(release1.id);
    expect(checksumOf(stored.definitions)).toBe(checksumOf(exported.definitions));
  });

  it('is idempotent: a second bootstrap creates nothing', async () => {
    await service.ensureRelease1();
    const second = await service.ensureRelease1();
    expect(second).toEqual({ created: false, version: 1 });
    expect((await service.listReleases()).releases).toHaveLength(1);
  });
});

describe('release lifecycle', () => {
  it('moves a draft through publish and retire', async () => {
    const bundle = await service.exportCurrent('draft');
    const draft = await service.importDraft(bundle);
    expect(draft.status).toBe('DRAFT');
    expect(draft.version).toBe(1);

    const published = await service.publish(draft.id, 'ship it');
    expect(published.status).toBe('PUBLISHED');
    expect(published.notes).toBe('ship it');

    const retired = await service.retire(draft.id, 'superseded');
    expect(retired.status).toBe('RETIRED');
    expect(retired.retiredAt).not.toBeNull();
  });

  it('assigns monotonically increasing versions', async () => {
    const bundle = await service.exportCurrent('v');
    const a = await service.importDraft(bundle);
    const b = await service.importDraft(bundle);
    expect(b.version).toBe(a.version + 1);
  });

  it('refuses to publish anything but a draft', async () => {
    const bundle = await service.exportCurrent('x');
    const draft = await service.importDraft(bundle);
    await service.publish(draft.id, '');
    await expect(service.publish(draft.id, '')).rejects.toMatchObject({ code: 'NOT_DRAFT' });
  });

  it('refuses to retire anything but a published release', async () => {
    const bundle = await service.exportCurrent('x');
    const draft = await service.importDraft(bundle);
    await expect(service.retire(draft.id, '')).rejects.toMatchObject({ code: 'NOT_PUBLISHED' });
  });
});

describe('published immutability', () => {
  it('blocks UPDATE and DELETE of a published release’s definitions at the database level', async () => {
    await service.ensureRelease1();
    const release1 = (await service.listReleases()).releases.find((r) => r.version === 1)!;
    const def = await prisma.contentDefinition.findFirst({ where: { releaseId: release1.id } });

    await expect(
      prisma.contentDefinition.update({ where: { id: def!.id }, data: { revision: 99 } }),
    ).rejects.toThrow();
    await expect(prisma.contentDefinition.delete({ where: { id: def!.id } })).rejects.toThrow();

    // The row is unchanged.
    const after = await prisma.contentDefinition.findUnique({ where: { id: def!.id } });
    expect(after?.revision).toBe(1);
  });

  it('allows editing a draft release’s definitions', async () => {
    const bundle = await service.exportCurrent('d');
    const draft = await service.importDraft(bundle);
    const def = await prisma.contentDefinition.findFirst({ where: { releaseId: draft.id } });
    // A draft is mutable until published.
    await expect(
      prisma.contentDefinition.update({ where: { id: def!.id }, data: { revision: 2 } }),
    ).resolves.toBeTruthy();
  });
});
