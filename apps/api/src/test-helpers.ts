import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import { type Env, loadEnv } from './config/env.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://rpg:rpg@localhost:5432/rpg_test';

export const TEST_ORIGIN = 'http://localhost:5173';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    // Wide chat limits so unrelated tests never trip the process-local
    // limiter (its per-IP bucket is shared across a file's requests); the
    // dedicated rate-limit test overrides these with a tiny bucket.
    CHAT_RATE_LIMIT_BURST: '100',
    CHAT_RATE_LIMIT_PER_MINUTE: '600',
    CHAT_RATE_LIMIT_IP_BURST: '200',
    CHAT_RATE_LIMIT_IP_PER_MINUTE: '1200',
    ...overrides,
  });
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
}

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  // Gameplay/account state only — seeded configuration tables
  // (CharacterClassDefinition, LevelProgression) are left intact.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ChatReport", "ChatMessage", "ChatChannelReadState", "ChatBlock", ' +
      '"ChatRestriction", ' +
      '"Notification", "ItemDestruction", "CharacterCollectionDonation", ' +
      '"QuestProgress", "CharacterQuest", ' +
      '"CombatRewardGrant", "CombatStatusEffect", "CombatantState", "Combat", ' +
      '"CraftingRun", "CraftingProfessionProgress", ' +
      '"GatheringRun", "CharacterSkill", ' +
      '"DeliveryLine", "Delivery", "MarketplaceSale", "MarketplaceListing", ' +
      '"PlayerShop", "NpcShopPurchase", "NpcShopStockEntry", "NpcShopRestock", ' +
      '"CurrencyTransaction", "CurrencyAccount", ' +
      '"ItemTransfer", "EquipmentAssignment", "InventoryCapacityReservation", ' +
      '"ItemInstance", "InventoryStack", "Character", "Session", "UserSettings", "User" ' +
      'RESTART IDENTITY CASCADE',
  );
  // Shops are seed config; reset their runtime restock state so every test
  // starts due for a fresh restock.
  await prisma.npcShop.updateMany({
    data: { nextRestockAt: new Date(0), lastRestockAt: null, currentRestockId: null },
  });
}

/** Registers a fresh user and returns its session cookie + CSRF token. */
export async function registerTestUser(
  app: FastifyInstance,
  overrides: { email?: string; displayName?: string } = {},
): Promise<{ cookie: string; csrf: string; userId: string }> {
  const unique = Math.random().toString(36).slice(2, 10);
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin: TEST_ORIGIN },
    payload: {
      email: overrides.email ?? `user-${unique}@example.com`,
      password: 'a test passphrase',
      displayName: overrides.displayName ?? `User${unique}`,
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`registerTestUser failed: ${response.statusCode} ${response.body}`);
  }
  const cookie = response.cookies.find((c) => c.name === 'rpg_session')!.value;
  const body = response.json();
  return { cookie, csrf: body.csrfToken, userId: body.user.id };
}

export async function buildTestApp(
  prisma: PrismaClient,
  options: {
    authRateLimit?: { max: number; timeWindowMs: number };
    envOverrides?: Record<string, string>;
  } = {},
): Promise<FastifyInstance> {
  return buildApp({
    env: testEnv(options.envOverrides),
    prisma,
    pingDatabase: async () => {
      await prisma.$queryRawUnsafe('SELECT 1');
    },
    // High default so unrelated tests never trip the limiter; the dedicated
    // rate-limit test builds its own app with a small max.
    authRateLimit: options.authRateLimit ?? { max: 10_000, timeWindowMs: 60_000 },
  });
}

/** Extracts the value of a named cookie from an inject() response. */
export function cookieValue(
  response: { cookies: Array<{ name: string; value: string }> },
  name: string,
): string | undefined {
  return response.cookies.find((c) => c.name === name)?.value;
}
