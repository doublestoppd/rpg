import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SESSION_COOKIE } from '../plugins/auth-plugin.js';
import {
  buildTestApp,
  createTestPrisma,
  registerTestUser,
  TEST_ORIGIN,
  truncateAll,
} from '../test-helpers.js';

let prisma: PrismaClient;
let app: FastifyInstance;

beforeAll(async () => {
  prisma = createTestPrisma();
  app = await buildTestApp(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
});

type Auth = { cookie: string; csrf: string };

/** Registers a character standing at the Crownfall City museum. */
async function setupPatron() {
  const auth = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Patron ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'vanguard' },
  });
  expect(created.statusCode).toBe(201);
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  // New characters already start at Crownfall City — the museum's home.
  return { auth, characterId: character.id };
}

async function grantInstance(characterId: string, slug: string) {
  const item = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug } });
  return prisma.itemInstance.create({
    data: { itemDefinitionId: item.id, ownerCharacterId: characterId },
  });
}

async function grantStack(characterId: string, slug: string, quantity: number) {
  const item = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug } });
  await prisma.inventoryStack.create({
    data: { characterId, itemDefinitionId: item.id, quantity },
  });
}

interface CollectionLite {
  id: string;
  slug: string;
  locationSlug: string;
  donatedCount: number;
  totalCount: number;
  entries: Array<{
    item: { slug: string; stackable: boolean };
    donated: boolean;
    curatorNote: string | null;
    ownedCount: number;
  }>;
}

async function getCollection(auth: { cookie: string }): Promise<CollectionLite> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/collections',
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
  expect(response.statusCode).toBe(200);
  const body = response.json<{ collections: CollectionLite[] }>();
  expect(body.collections).toHaveLength(1);
  return body.collections[0]!;
}

function donate(auth: Auth, collectionId: string, itemSlug: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/collections/${collectionId}/donations`,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { itemSlug },
  });
}

describe('collection configuration', () => {
  it('seeds Regional Artifacts at Crownfall City with exactly the three collectibles', async () => {
    const { auth } = await setupPatron();
    const collection = await getCollection(auth);
    expect(collection.slug).toBe('regional-artifacts');
    expect(collection.locationSlug).toBe('crownfall-city');
    expect(collection.totalCount).toBe(3);
    expect(collection.entries.map((e) => e.item.slug).sort()).toEqual([
      'ancient-trade-seal',
      'painted-river-pebble',
      'sunken-crown-fragment',
    ]);
    // Curator notes stay hidden until donated.
    expect(collection.entries.every((e) => e.curatorNote === null)).toBe(true);
    const items = await prisma.itemDefinition.findMany({ where: { category: 'COLLECTIBLE' } });
    expect(items).toHaveLength(3);
  });
});

describe('donating', () => {
  it('donates an instance: ownership removed, destroyed, recorded, revealed', async () => {
    const { auth, characterId } = await setupPatron();
    const instance = await grantInstance(characterId, 'sunken-crown-fragment');
    const collection = await getCollection(auth);

    const response = await donate(auth, collection.id, 'sunken-crown-fragment');
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      collection: CollectionLite;
      entry: { donated: boolean; curatorNote: string | null };
    }>();
    expect(body.entry.donated).toBe(true);
    expect(body.entry.curatorNote).toContain('royal barge');
    expect(body.collection.donatedCount).toBe(1);

    const after = await prisma.itemInstance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(after.ownerCharacterId).toBeNull();
    expect(after.destroyedAt).not.toBeNull();
    const destruction = await prisma.itemDestruction.findFirstOrThrow({
      where: { characterId },
    });
    expect(destruction.itemInstanceId).toBe(instance.id);
    expect(destruction.reason).toBe('MUSEUM_DONATION');
    const transfer = await prisma.itemTransfer.findFirstOrThrow({
      where: { fromCharacterId: characterId, reason: 'MUSEUM_DONATION' },
    });
    expect(transfer.toCharacterId).toBeNull();
  });

  it('donates from a stack: quantity reduced by one, remainder kept', async () => {
    const { auth, characterId } = await setupPatron();
    await grantStack(characterId, 'painted-river-pebble', 3);
    const collection = await getCollection(auth);

    const response = await donate(auth, collection.id, 'painted-river-pebble');
    expect(response.statusCode).toBe(200);
    const stack = await prisma.inventoryStack.findFirstOrThrow({
      where: { characterId, itemDefinition: { slug: 'painted-river-pebble' } },
    });
    expect(stack.quantity).toBe(2);
    const destruction = await prisma.itemDestruction.findFirstOrThrow({ where: { characterId } });
    expect(destruction.quantity).toBe(1);
    expect(destruction.itemInstanceId).toBeNull();
  });

  it('rejects a duplicate donation and keeps the second copy', async () => {
    const { auth, characterId } = await setupPatron();
    await grantInstance(characterId, 'ancient-trade-seal');
    await grantInstance(characterId, 'ancient-trade-seal');
    const collection = await getCollection(auth);

    expect((await donate(auth, collection.id, 'ancient-trade-seal')).statusCode).toBe(200);
    const again = await donate(auth, collection.id, 'ancient-trade-seal');
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_DONATED');
    // Exactly one copy left, exactly one donation and destruction recorded.
    expect(
      await prisma.itemInstance.count({
        where: {
          ownerCharacterId: characterId,
          itemDefinition: { slug: 'ancient-trade-seal' },
          destroyedAt: null,
        },
      }),
    ).toBe(1);
    expect(await prisma.characterCollectionDonation.count({ where: { characterId } })).toBe(1);
    expect(await prisma.itemDestruction.count({ where: { characterId } })).toBe(1);
  });

  it('rejects locked states: equipped, listed, and in-transit instances', async () => {
    const { auth, characterId } = await setupPatron();
    const collection = await getCollection(auth);
    const seal = await prisma.itemDefinition.findUniqueOrThrow({
      where: { slug: 'ancient-trade-seal' },
    });

    // No copy at all.
    const missing = await donate(auth, collection.id, 'ancient-trade-seal');
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error.code).toBe('ITEM_UNAVAILABLE');

    // A LISTED copy is out of active inventory.
    const listed = await prisma.itemInstance.create({
      data: { itemDefinitionId: seal.id, ownerCharacterId: characterId, lockState: 'LISTED' },
    });
    expect((await donate(auth, collection.id, 'ancient-trade-seal')).statusCode).toBe(409);

    // An IN_TRANSIT copy is untouchable too.
    await prisma.itemInstance.update({
      where: { id: listed.id },
      data: { lockState: 'IN_TRANSIT' },
    });
    expect((await donate(auth, collection.id, 'ancient-trade-seal')).statusCode).toBe(409);

    // An equipped item cannot be donated (use real equipment for the slot).
    const tunic = await prisma.itemInstance.findFirstOrThrow({
      where: { ownerCharacterId: characterId, itemDefinition: { slug: 'quilted-tunic' } },
    });
    await prisma.equipmentAssignment.create({
      data: { characterId, slot: 'BODY', itemInstanceId: tunic.id },
    });
    // quilted-tunic is not a collection entry, so donation is NOT_ELIGIBLE —
    // prove the equipped filter directly instead: an equipped seal.
    await prisma.itemInstance.update({
      where: { id: listed.id },
      data: { lockState: 'NONE' },
    });
    await prisma.equipmentAssignment.deleteMany({ where: { characterId } });
    await prisma.equipmentAssignment.create({
      data: { characterId, slot: 'ACCESSORY_1', itemInstanceId: listed.id },
    });
    const equipped = await donate(auth, collection.id, 'ancient-trade-seal');
    expect(equipped.statusCode).toBe(409);
    expect(equipped.json().error.code).toBe('ITEM_UNAVAILABLE');
    // Nothing was recorded through all those rejections.
    expect(await prisma.characterCollectionDonation.count({ where: { characterId } })).toBe(0);
    expect(await prisma.itemDestruction.count({ where: { characterId } })).toBe(0);
  });

  it('rejects donations away from the museum', async () => {
    const { auth, characterId } = await setupPatron();
    await grantInstance(characterId, 'sunken-crown-fragment');
    const collection = await getCollection(auth);
    const mine = await prisma.location.findUniqueOrThrow({ where: { slug: 'ironroot-mine' } });
    await prisma.character.update({
      where: { id: characterId },
      data: { currentLocationId: mine.id },
    });
    const response = await donate(auth, collection.id, 'sunken-crown-fragment');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NOT_HERE');
  });

  it('rejects items outside the collection', async () => {
    const { auth } = await setupPatron();
    const collection = await getCollection(auth);
    const response = await donate(auth, collection.id, 'copper-ore');
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_ELIGIBLE');
  });
});

describe('quest atomicity', () => {
  it('the donation quest completes in the same transaction as the donation', async () => {
    const { auth, characterId } = await setupPatron();
    await grantInstance(characterId, 'sunken-crown-fragment');
    // Accept "A Gift for the Museum".
    const quest = await prisma.questDefinition.findUniqueOrThrow({
      where: { slug: 'a-gift-for-the-museum' },
    });
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/quests/${quest.id}/accept`,
      headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(accepted.statusCode).toBe(200);

    const collection = await getCollection(auth);
    expect((await donate(auth, collection.id, 'sunken-crown-fragment')).statusCode).toBe(200);

    // Collection and quest cannot diverge: the donation exists iff the
    // quest progressed.
    const donation = await prisma.characterCollectionDonation.findFirstOrThrow({
      where: { characterId },
    });
    expect(donation).toBeTruthy();
    const characterQuest = await prisma.characterQuest.findUniqueOrThrow({
      where: { characterId_questId: { characterId, questId: quest.id } },
      include: { progress: true },
    });
    expect(characterQuest.status).toBe('COMPLETED_UNCLAIMED');
    expect(characterQuest.progress[0]!.currentCount).toBe(1);
  });

  it('a rejected donation moves neither the collection nor the quest', async () => {
    const { auth, characterId } = await setupPatron();
    // No artifact owned; quest accepted.
    const quest = await prisma.questDefinition.findUniqueOrThrow({
      where: { slug: 'a-gift-for-the-museum' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/quests/${quest.id}/accept`,
      headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    const collection = await getCollection(auth);
    expect((await donate(auth, collection.id, 'sunken-crown-fragment')).statusCode).toBe(409);
    expect(await prisma.characterCollectionDonation.count({ where: { characterId } })).toBe(0);
    const characterQuest = await prisma.characterQuest.findUniqueOrThrow({
      where: { characterId_questId: { characterId, questId: quest.id } },
      include: { progress: true },
    });
    expect(characterQuest.status).toBe('ACTIVE');
    expect(characterQuest.progress[0]!.currentCount).toBe(0);
  });
});
