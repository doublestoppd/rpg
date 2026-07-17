import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

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

async function setupCharacter(locationSlug = 'crownfall-city', classSlug = 'vanguard') {
  const auth = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Herald ${Math.random().toString(36).slice(2, 8)}`, classSlug },
  });
  expect(created.statusCode).toBe(201);
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  const location = await prisma.location.findUniqueOrThrow({ where: { slug: locationSlug } });
  await prisma.character.update({
    where: { id: character.id },
    data: { currentLocationId: location.id },
  });
  return { auth, characterId: character.id };
}

interface NotificationLite {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
}

async function listNotifications(auth: { cookie: string }) {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/notifications',
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ notifications: NotificationLite[]; unreadCount: number }>();
}

function post(auth: Auth, url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url,
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    ...(payload ? { payload } : {}),
  });
}

/** Starts and force-finishes a travel leg; the next status call finalizes. */
async function completeTravel(auth: Auth, destinationSlug: string, key: string) {
  const started = await post(auth, '/api/v1/travel/start', {
    destinationSlug,
    idempotencyKey: key,
  });
  expect(started.statusCode).toBe(200);
  await prisma.travelState.updateMany({
    where: { status: 'IN_PROGRESS' },
    data: { completesAt: new Date(Date.now() - 1000) },
  });
  const status = await app.inject({
    method: 'GET',
    url: '/api/v1/travel/status',
    cookies: { [SESSION_COOKIE]: auth.cookie },
  });
  expect(status.statusCode).toBe(200);
}

describe('event-driven notification generation', () => {
  it('travel arrival stores a TRAVEL_COMPLETED notification', async () => {
    const { auth } = await setupCharacter();
    await completeTravel(auth, 'crownfall-market-district', 'notify-travel');
    const { notifications, unreadCount } = await listNotifications(auth);
    expect(unreadCount).toBe(1);
    expect(notifications[0]).toMatchObject({ type: 'TRAVEL_COMPLETED', readAt: null });
    expect(notifications[0]!.body).toContain('Crownfall Market District');
  });

  it('gathering and crafting completions store notifications', async () => {
    const { auth, characterId } = await setupCharacter('ironroot-mine');
    const started = await post(auth, '/api/v1/gathering/start', {
      actionSlug: 'mine-copper-seam',
      idempotencyKey: 'notify-mine-1',
    });
    expect(started.statusCode).toBe(200);
    await prisma.gatheringRun.updateMany({
      where: { characterId },
      data: { completesAt: new Date(Date.now() - 1000) },
    });
    await app.inject({
      method: 'GET',
      url: '/api/v1/gathering/status',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });

    // Crafting: move to the forge with materials.
    const market = await prisma.location.findUniqueOrThrow({
      where: { slug: 'crownfall-market-district' },
    });
    await prisma.character.update({
      where: { id: characterId },
      data: { currentLocationId: market.id },
    });
    for (const [slug, quantity] of [
      ['copper-ore', 3],
      ['forge-coal', 1],
    ] as const) {
      const item = await prisma.itemDefinition.findUniqueOrThrow({ where: { slug } });
      await prisma.inventoryStack.upsert({
        where: {
          characterId_itemDefinitionId: { characterId, itemDefinitionId: item.id },
        },
        create: { characterId, itemDefinitionId: item.id, quantity },
        update: { quantity: { increment: quantity } },
      });
    }
    const crafted = await post(auth, '/api/v1/crafting/start', {
      recipeSlug: 'smelt-copper-ingot',
      idempotencyKey: 'notify-craft1',
    });
    expect(crafted.statusCode).toBe(200);
    await prisma.craftingRun.updateMany({
      where: { characterId },
      data: { completesAt: new Date(Date.now() - 1000) },
    });
    await app.inject({
      method: 'GET',
      url: '/api/v1/crafting/status',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });

    const { notifications } = await listNotifications(auth);
    const types = notifications.map((n) => n.type).sort();
    expect(types).toContain('GATHERING_COMPLETED');
    expect(types).toContain('CRAFTING_COMPLETED');
  });

  it('quest completion stores a QUEST_COMPLETED notification', async () => {
    const { auth } = await setupCharacter();
    const quest = await prisma.questDefinition.findUniqueOrThrow({
      where: { slug: 'errand-to-the-market' },
    });
    expect((await post(auth, `/api/v1/quests/${quest.id}/accept`)).statusCode).toBe(200);
    await completeTravel(auth, 'crownfall-market-district', 'notify-quest1');
    const { notifications } = await listNotifications(auth);
    const questNote = notifications.find((n) => n.type === 'QUEST_COMPLETED');
    expect(questNote).toBeDefined();
    expect(questNote!.body).toContain('Errand to the Market');
  });

  it('a sale notifies the seller and a remote delivery notifies the buyer', async () => {
    // Seller with a shop and a local listing at the Market District.
    const { auth: seller, characterId: sellerId } = await setupCharacter(
      'crownfall-market-district',
    );
    expect(
      (
        await post(seller, '/api/v1/player-shops', {
          name: `Notify Goods ${Math.random().toString(36).slice(2, 6)}`,
          description: 'Wares',
          region: 'deepvale', // remote from the crownfall marketplace
        })
      ).statusCode,
    ).toBe(201);
    const draught = await prisma.itemDefinition.findUniqueOrThrow({
      where: { slug: 'lesser-healing-draught' },
    });
    const listed = await post(seller, '/api/v1/marketplace/listings', {
      itemSlug: 'lesser-healing-draught',
      quantity: 1,
      price: '25',
      idempotencyKey: 'notify-list-1',
    });
    expect(listed.statusCode).toBe(201);
    const listingId = listed.json<{ listingId: string }>().listingId;
    void draught;

    // The buyer purchases at the marketplace; the shop's region is remote,
    // so the goods travel by delivery while the seller is notified now.
    const { auth: buyer, characterId: buyerId } = await setupCharacter('crownfall-market-district');
    const bought = await post(buyer, `/api/v1/marketplace/listings/${listingId}/purchase`, {
      idempotencyKey: 'notify-buy-1',
    });
    expect(bought.statusCode).toBe(200);

    const sellerList = await listNotifications(seller);
    const sold = sellerList.notifications.find((n) => n.type === 'LISTING_SOLD');
    expect(sold).toBeDefined();
    expect(sold!.body).toContain('25 Gold');

    // Force the delivery to arrive; the buyer's next inventory view
    // finalizes it and stores the delivery notification.
    await prisma.delivery.updateMany({
      where: { buyerCharacterId: buyerId },
      data: { arrivesAt: new Date(Date.now() - 1000) },
    });
    await app.inject({
      method: 'GET',
      url: '/api/v1/deliveries',
      cookies: { [SESSION_COOKIE]: buyer.cookie },
    });
    const buyerList = await listNotifications(buyer);
    expect(buyerList.notifications.some((n) => n.type === 'DELIVERY_COMPLETED')).toBe(true);
    void sellerId;
  });
});

describe('idempotent notification keys', () => {
  it('the same domain event key never produces a duplicate', async () => {
    const { auth, characterId } = await setupCharacter();
    await completeTravel(auth, 'crownfall-market-district', 'notify-dupe-1');
    // Replay the finalization path several times (worker + lazy would race
    // exactly like this): the dedupe key keeps it at one row.
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'GET',
        url: '/api/v1/travel/status',
        cookies: { [SESSION_COOKIE]: auth.cookie },
      });
    }
    expect(await prisma.notification.count({ where: { characterId } })).toBe(1);

    // Direct double-create with the same key: second write is a no-op.
    const state = await prisma.travelState.findFirstOrThrow({ where: { characterId } });
    await prisma.notification.createMany({
      data: {
        characterId,
        type: 'TRAVEL_COMPLETED',
        dedupeKey: `travel:${state.id}`,
        payload: { title: 'dup', body: 'dup' },
      },
      skipDuplicates: true,
    });
    expect(await prisma.notification.count({ where: { characterId } })).toBe(1);
  });
});

describe('reading', () => {
  it('marks one and all read; foreign notifications are invisible', async () => {
    const { auth } = await setupCharacter();
    await completeTravel(auth, 'crownfall-market-district', 'notify-read-1');
    await completeTravel(auth, 'crownfall-city', 'notify-read-2');
    let list = await listNotifications(auth);
    expect(list.unreadCount).toBe(2);

    const readOne = await post(auth, `/api/v1/notifications/${list.notifications[0]!.id}/read`);
    expect(readOne.statusCode).toBe(200);
    list = await listNotifications(auth);
    expect(list.unreadCount).toBe(1);

    expect((await post(auth, '/api/v1/notifications/read-all')).statusCode).toBe(200);
    list = await listNotifications(auth);
    expect(list.unreadCount).toBe(0);

    // Another character cannot read or mark ours.
    const { auth: other } = await setupCharacter();
    const foreign = await post(other, `/api/v1/notifications/${list.notifications[0]!.id}/read`);
    expect(foreign.statusCode).toBe(404);
    expect((await listNotifications(other)).notifications).toHaveLength(0);
  });
});

describe('live socket and fallback', () => {
  it('pushes sync nudges to connected sockets and REST keeps working after disconnect', async () => {
    const { auth, characterId } = await setupCharacter();
    // Real server socket for the WS upgrade.
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/v1/notifications/ws`, {
      headers: { cookie: `${SESSION_COOKIE}=${auth.cookie}` },
    });
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve());
      socket.on('error', reject);
    });

    const message = new Promise<string>((resolve) => {
      socket.on('message', (data: Buffer) => resolve(data.toString()));
    });
    // A notification created for this character nudges the socket.
    await prisma.$transaction(async () => undefined); // no-op warmup
    await completeTravel(auth, 'crownfall-market-district', 'notify-live-1');
    const received = JSON.parse(await message) as { type: string };
    expect(received.type).toBe('sync');

    // Disconnect: gameplay and notification reads continue over REST.
    socket.close();
    await new Promise((resolve) => socket.once('close', resolve));
    await completeTravel(auth, 'crownfall-city', 'notify-live-2');
    const list = await listNotifications(auth);
    expect(list.notifications.length).toBe(2);
    expect(await prisma.notification.count({ where: { characterId } })).toBe(2);
  });
});
