import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createInventoryService, TRANSFER_REASONS } from '../domain/inventory/inventory-service.js';
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
const inventoryOf = () => createInventoryService(prisma);

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

async function setupCharacter(classSlug = 'vanguard') {
  const auth = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Porter ${Math.random().toString(36).slice(2, 8)}`, classSlug },
  });
  expect(created.statusCode).toBe(201);
  const character = await prisma.character.findFirstOrThrow({
    orderBy: { createdAt: 'desc' },
  });
  return { auth, characterId: character.id };
}

async function grantStack(characterId: string, slug: string, quantity: number) {
  const def = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug } });
  await prisma.$transaction((tx) =>
    inventoryOf().addToStack(tx, {
      characterId,
      itemDefinitionId: def.id,
      quantity,
      reason: TRANSFER_REASONS.TEST_GRANT,
    }),
  );
  return def;
}

async function grantInstance(characterId: string, slug: string) {
  const def = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug } });
  return prisma.$transaction((tx) =>
    inventoryOf().grantInstance(tx, {
      characterId,
      itemDefinitionId: def.id,
      reason: TRANSFER_REASONS.TEST_GRANT,
    }),
  );
}

function getInventory(auth: { cookie: string }) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/inventory',
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
}

function equip(
  auth: { cookie: string; csrf: string },
  payload: { itemInstanceId: string; slot?: string },
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/equipment/equip',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload,
  });
}

function unequip(auth: { cookie: string; csrf: string }, slot: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/equipment/unequip',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { slot },
  });
}

describe('item catalog', () => {
  it('seeds the coherent catalog with required category counts', async () => {
    const items = await prisma.itemDefinition.findMany();
    expect(items).toHaveLength(27);
    const byCategory = new Map<string, number>();
    for (const item of items) {
      byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1);
    }
    expect(byCategory.get('RESOURCE')).toBe(5);
    // Four restoratives plus the two combat summon totems (party combat).
    expect(byCategory.get('CONSUMABLE')).toBe(6);
    expect(byCategory.get('EQUIPMENT')).toBe(6);
    expect(byCategory.get('CRAFTING_COMPONENT')).toBe(3);
    expect(byCategory.get('COLLECTIBLE')).toBe(3);
    expect(byCategory.get('QUEST_ITEM')).toBe(2);
    expect(byCategory.get('SPECIALTY')).toBe(2);
    // Stackable vs instance behavior is unambiguous per definition.
    for (const item of items) {
      if (item.stackable) expect(item.maxStackQuantity).toBeGreaterThan(1);
      else expect(item.maxStackQuantity).toBe(1);
      if (item.category === 'EQUIPMENT') expect(item.equipmentSlot).not.toBeNull();
    }
  });

  it('serves item definitions by slug', async () => {
    const { auth } = await setupCharacter();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/items/bronze-longblade',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.name).toBe('Bronze Longblade');
    expect(body.bonuses.strength).toBe(4);
    expect(body.equipmentSlot).toBe('MAIN_HAND');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/items/unobtainium',
          cookies: { [SESSION_COOKIE]: auth.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('stacks', () => {
  it('adds, merges, removes, and deletes stacks with transfer records', async () => {
    const { auth, characterId } = await setupCharacter();
    const def = await grantStack(characterId, 'copper-ore', 10);
    await grantStack(characterId, 'copper-ore', 5);

    let inventory = (await getInventory(auth)).json();
    const stack = inventory.stacks.find(
      (s: { item: { slug: string } }) => s.item.slug === 'copper-ore',
    );
    expect(stack.quantity).toBe(15);

    await prisma.$transaction((tx) =>
      inventoryOf().removeFromStack(tx, {
        characterId,
        itemDefinitionId: def.id,
        quantity: 15,
        reason: 'TEST_REMOVE',
      }),
    );
    inventory = (await getInventory(auth)).json();
    expect(
      inventory.stacks.some((s: { item: { slug: string } }) => s.item.slug === 'copper-ore'),
    ).toBe(false);

    // Aggregate transfers: one per movement, not per unit.
    const transfers = await prisma.itemTransfer.findMany({
      where: { itemDefinitionId: def.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(transfers.map((t) => t.quantity)).toEqual([10, 5, 15]);
    expect(transfers[2]!.fromCharacterId).toBe(characterId);
  });

  it('enforces the stack maximum and rejects over-removal', async () => {
    const { characterId } = await setupCharacter();
    const def = await grantStack(characterId, 'glimmer-crystal', 50); // max 50
    await expect(
      prisma.$transaction((tx) =>
        inventoryOf().addToStack(tx, {
          characterId,
          itemDefinitionId: def.id,
          quantity: 1,
          reason: 'TEST',
        }),
      ),
    ).rejects.toMatchObject({ code: 'STACK_LIMIT' });
    await expect(
      prisma.$transaction((tx) =>
        inventoryOf().removeFromStack(tx, {
          characterId,
          itemDefinitionId: def.id,
          quantity: 51,
          reason: 'TEST',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_ITEMS' });
  });
});

describe('capacity accounting', () => {
  it('counts stacks, loose instances, and reservations; equipped items are free', async () => {
    const { auth, characterId } = await setupCharacter();
    // Starter kit: 1 stack (draughts) + 1 loose instance (tunic) = 2 slots.
    let inventory = (await getInventory(auth)).json();
    expect(inventory.slots.used).toBe(2);
    expect(inventory.slots.capacity).toBe(24);

    const cap = await grantInstance(characterId, 'worn-leather-cap');
    inventory = (await getInventory(auth)).json();
    expect(inventory.slots.used).toBe(3);

    // Equipping frees the slot.
    const equipRes = await equip(auth, { itemInstanceId: cap.id });
    expect(equipRes.statusCode).toBe(200);
    inventory = (await getInventory(auth)).json();
    expect(inventory.slots.used).toBe(2);
    const capRow = inventory.instances.find((i: { id: string }) => i.id === cap.id);
    expect(capRow.equippedSlot).toBe('HEAD');

    // Reservations hold capacity.
    await prisma.inventoryCapacityReservation.create({
      data: { characterId, slots: 3, reason: 'TEST_HOLD' },
    });
    inventory = (await getInventory(auth)).json();
    expect(inventory.slots.used).toBe(5);
    expect(inventory.slots.reserved).toBe(3);
  });

  it('rejects grants beyond capacity, honoring reservations', async () => {
    const { characterId } = await setupCharacter();
    // Fill remaining capacity with a giant reservation (starter kit used 2).
    await prisma.inventoryCapacityReservation.create({
      data: { characterId, slots: 22, reason: 'TEST_FILL' },
    });
    await expect(grantStack(characterId, 'iron-ore', 1)).rejects.toMatchObject({
      code: 'INVENTORY_FULL',
    });
    await expect(grantInstance(characterId, 'worn-leather-cap')).rejects.toMatchObject({
      code: 'INVENTORY_FULL',
    });
    // Existing stacks can still grow — no new slot needed.
    await expect(grantStack(characterId, 'lesser-healing-draught', 3)).resolves.toBeDefined();
  });

  it('keeps invariants under concurrent stack mutations', async () => {
    const { characterId } = await setupCharacter();
    const def = await grantStack(characterId, 'copper-ore', 50);
    // 10 concurrent removals of 10 each: only 5 can succeed.
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        prisma.$transaction(async (tx) => {
          await inventoryOf().lockCharacter(tx, characterId);
          await inventoryOf().removeFromStack(tx, {
            characterId,
            itemDefinitionId: def.id,
            quantity: 10,
            reason: 'TEST_CONCURRENT',
          });
        }),
      ),
    );
    const succeeded = attempts.filter((a) => a.status === 'fulfilled').length;
    expect(succeeded).toBe(5);
    const stack = await prisma.inventoryStack.findFirst({
      where: { characterId, itemDefinitionId: def.id },
    });
    expect(stack).toBeNull(); // exactly emptied, never negative
    const removed = await prisma.itemTransfer.aggregate({
      where: { itemDefinitionId: def.id, reason: 'TEST_CONCURRENT' },
      _sum: { quantity: true },
    });
    expect(removed._sum.quantity).toBe(50);
  });
});

describe('instances and equipment', () => {
  it('tracks instance ownership history through transfers', async () => {
    const { characterId } = await setupCharacter();
    const blade = await grantInstance(characterId, 'bronze-longblade');
    const transfers = await prisma.itemTransfer.findMany({
      where: { itemInstanceId: blade.id },
    });
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      toCharacterId: characterId,
      quantity: 1,
      reason: TRANSFER_REASONS.TEST_GRANT,
    });
  });

  it('equips and unequips with slot rules, swaps, and level requirements', async () => {
    const { auth, characterId } = await setupCharacter();
    const tunic = await prisma.itemInstance.findFirstOrThrow({
      where: { ownerCharacterId: characterId },
    });

    // Equip the starter tunic; stats gain its bonuses.
    expect((await equip(auth, { itemInstanceId: tunic.id })).statusCode).toBe(200);
    const stats = await app.inject({
      method: 'GET',
      url: '/api/v1/characters/me/stats',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(stats.json().resources.maxHp).toBe(125); // 120 base + 5 tunic
    expect(stats.json().attributes.defense).toBe(14); // 12 base + 2 tunic

    // Level requirement: bronze longblade needs level 3.
    const blade = await grantInstance(characterId, 'bronze-longblade');
    const tooLow = await equip(auth, { itemInstanceId: blade.id });
    expect(tooLow.statusCode).toBe(400);
    expect(tooLow.json().error.code).toBe('LEVEL_TOO_LOW');

    // Wrong slot rejected; accessories pick a free accessory slot.
    const charm = await grantInstance(characterId, 'lucky-riverstone-charm');
    expect((await equip(auth, { itemInstanceId: charm.id, slot: 'HEAD' })).statusCode).toBe(400);
    expect((await equip(auth, { itemInstanceId: charm.id })).statusCode).toBe(200);
    const charm2 = await grantInstance(characterId, 'lucky-riverstone-charm');
    expect((await equip(auth, { itemInstanceId: charm2.id })).statusCode).toBe(200);
    const assignments = await prisma.equipmentAssignment.findMany({ where: { characterId } });
    expect(assignments.map((a) => a.slot).sort()).toEqual(['ACCESSORY_1', 'ACCESSORY_2', 'BODY']);

    // Unequip returns to inventory (needs a free slot).
    expect((await unequip(auth, 'BODY')).statusCode).toBe(200);
    expect((await unequip(auth, 'BODY')).statusCode).toBe(404);
  });

  it('unequip requires an available inventory slot', async () => {
    const { auth, characterId } = await setupCharacter();
    const tunic = await prisma.itemInstance.findFirstOrThrow({
      where: { ownerCharacterId: characterId },
    });
    expect((await equip(auth, { itemInstanceId: tunic.id })).statusCode).toBe(200);
    // Fill every remaining slot with a reservation (1 stack currently used).
    await prisma.inventoryCapacityReservation.create({
      data: { characterId, slots: 23, reason: 'TEST_FILL' },
    });
    const blocked = await unequip(auth, 'BODY');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('INVENTORY_FULL');
  });

  it('rejects equipping locked (listed / in-transit) assets', async () => {
    const { auth, characterId } = await setupCharacter();
    const cap = await grantInstance(characterId, 'worn-leather-cap');
    await prisma.itemInstance.update({ where: { id: cap.id }, data: { lockState: 'LISTED' } });
    const listed = await equip(auth, { itemInstanceId: cap.id });
    expect(listed.statusCode).toBe(409);
    expect(listed.json().error.code).toBe('ITEM_LOCKED');

    await prisma.itemInstance.update({ where: { id: cap.id }, data: { lockState: 'IN_TRANSIT' } });
    expect((await equip(auth, { itemInstanceId: cap.id })).statusCode).toBe(409);

    // Locked instances also leave active inventory slot accounting.
    const inventory = (await getInventory(auth)).json();
    const row = inventory.instances.find((i: { id: string }) => i.id === cap.id);
    expect(row.lockState).toBe('IN_TRANSIT');
  });

  it("rejects equipping someone else's instance", async () => {
    const { characterId } = await setupCharacter();
    const blade = await grantInstance(characterId, 'worn-leather-cap');
    const other = await setupCharacter('wayfarer');
    const stolen = await equip(other.auth, { itemInstanceId: blade.id });
    expect(stolen.statusCode).toBe(404);
  });
});

describe('starter kit', () => {
  it('new characters receive draughts and a tunic with transfer records', async () => {
    const { auth, characterId } = await setupCharacter();
    const inventory = (await getInventory(auth)).json();
    expect(inventory.stacks).toHaveLength(1);
    expect(inventory.stacks[0].item.slug).toBe('lesser-healing-draught');
    expect(inventory.stacks[0].quantity).toBe(2);
    expect(inventory.instances).toHaveLength(1);
    expect(inventory.instances[0].item.slug).toBe('quilted-tunic');

    const transfers = await prisma.itemTransfer.findMany({
      where: { toCharacterId: characterId, reason: TRANSFER_REASONS.STARTER_KIT },
    });
    expect(transfers).toHaveLength(2);
  });
});

describe('rarity and rolled affixes (Improvement Phase 2)', () => {
  function stats(auth: { cookie: string }) {
    return app.inject({
      method: 'GET',
      url: '/api/v1/characters/me/stats',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
  }

  it('plain granted instances default to COMMON with no affixes', async () => {
    const { auth } = await setupCharacter();
    const tunic = (await getInventory(auth)).json().instances[0];
    expect(tunic.rarity).toBe('COMMON');
    expect(tunic.affixes).toEqual([]);
    // Effective bonuses of a plain item equal its definition bonuses.
    expect(tunic.effectiveBonuses).toEqual(tunic.item.bonuses);
  });

  it('surfaces rarity, affixes, and effective (definition + affix) bonuses', async () => {
    const { auth, characterId } = await setupCharacter();
    const def = await prisma.itemDefinition.findUniqueOrThrow({
      where: { slug: 'apprentice-focus' }, // MAIN_HAND, +4 Magic, level 1
    });
    await prisma.$transaction((tx) =>
      inventoryOf().grantInstance(tx, {
        characterId,
        itemDefinitionId: def.id,
        reason: TRANSFER_REASONS.TEST_GRANT,
        rarity: 'RARE',
        affixes: [
          { stat: 'luck', magnitude: 2, label: 'of Fortune' },
          { stat: 'maxHp', magnitude: 10, label: 'of Vitality' },
        ],
      }),
    );

    const focus = (await getInventory(auth))
      .json()
      .instances.find((i: { item: { slug: string } }) => i.item.slug === 'apprentice-focus');
    expect(focus.rarity).toBe('RARE');
    expect(focus.affixes).toHaveLength(2);
    expect(focus.effectiveBonuses.magic).toBe(4); // definition base
    expect(focus.effectiveBonuses.luck).toBe(2); // affix
    expect(focus.effectiveBonuses.maxHp).toBe(10); // affix
  });

  it('equipping an affixed item raises the wearer’s derived stats', async () => {
    const { auth, characterId } = await setupCharacter();
    const before = (await stats(auth)).json();

    const def = await prisma.itemDefinition.findUniqueOrThrow({
      where: { slug: 'apprentice-focus' },
    });
    const instance = await prisma.$transaction((tx) =>
      inventoryOf().grantInstance(tx, {
        characterId,
        itemDefinitionId: def.id,
        reason: TRANSFER_REASONS.TEST_GRANT,
        rarity: 'RARE',
        affixes: [
          { stat: 'luck', magnitude: 2, label: 'of Fortune' },
          { stat: 'maxHp', magnitude: 10, label: 'of Vitality' },
        ],
      }),
    );

    const equipped = await equip(auth, { itemInstanceId: instance.id });
    expect(equipped.statusCode).toBe(200);

    const after = (await stats(auth)).json();
    // Definition (+4 Magic) and affixes (+2 Luck, +10 Max HP) all apply.
    expect(after.attributes.magic - before.attributes.magic).toBe(4);
    expect(after.attributes.luck - before.attributes.luck).toBe(2);
    expect(after.resources.maxHp - before.resources.maxHp).toBe(10);
  });
});
