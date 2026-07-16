import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createCurrencyService, CURRENCY_TYPES } from '../domain/currency/currency-service.js';
import { applyBasisPoints } from '../lib/money.js';
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
const currency = () => createCurrencyService(prisma);

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

async function setupCharacter() {
  const auth = await registerTestUser(app);
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/characters',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { name: `Miser ${Math.random().toString(36).slice(2, 8)}`, classSlug: 'vanguard' },
  });
  expect(created.statusCode).toBe(201);
  const character = await prisma.character.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  return { auth, characterId: character.id };
}

function rest(auth: { cookie: string; csrf: string }, idempotencyKey: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/locations/current/inn/rest',
    headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
    cookies: { [SESSION_COOKIE]: auth.cookie },
    payload: { idempotencyKey },
  });
}

describe('accounts and starting grant', () => {
  it('opens the account with the starting grant and one ledger entry', async () => {
    const { auth, characterId } = await setupCharacter();
    const balance = await app.inject({
      method: 'GET',
      url: '/api/v1/currency',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(balance.json()).toEqual({ gold: '100' });

    const account = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
    expect(account.balance).toBe(100n);
    const entries = await prisma.currencyTransaction.findMany({
      where: { accountId: account.id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: CURRENCY_TYPES.STARTING_GRANT,
      amount: 100n,
      balanceBefore: 0n,
      balanceAfter: 100n,
    });

    // Character response reads the account (precision preserved end to end).
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/characters/me',
      cookies: { [SESSION_COOKIE]: auth.cookie },
    });
    expect(me.json().gold).toBe('100');
  });
});

describe('credit and debit', () => {
  it('applies changes with exactly one ledger entry each, in the same transaction', async () => {
    const { characterId } = await setupCharacter();

    await prisma.$transaction(async (tx) => {
      const credit = await currency().credit(tx, {
        characterId,
        amount: 12345678901234n, // BIGINT territory, beyond float comfort
        type: CURRENCY_TYPES.TEST,
        operationNamespace: 'test',
      });
      expect(credit.applied).toBe(true);
      expect(credit.transaction.balanceAfter).toBe(12345678901334n);
    });
    await prisma.$transaction(async (tx) => {
      const debit = await currency().debit(tx, {
        characterId,
        amount: 34n,
        type: CURRENCY_TYPES.TEST,
        operationNamespace: 'test',
      });
      expect(debit.transaction.amount).toBe(-34n);
      expect(debit.transaction.balanceAfter).toBe(12345678901300n);
    });

    const account = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
    expect(account.balance).toBe(12345678901300n);
    expect(await prisma.currencyTransaction.count({ where: { accountId: account.id } })).toBe(3);
  });

  it('rejects debits that would go negative, atomically', async () => {
    const { characterId } = await setupCharacter();
    await expect(
      prisma.$transaction((tx) =>
        currency().debit(tx, {
          characterId,
          amount: 101n,
          type: CURRENCY_TYPES.TEST,
          operationNamespace: 'test',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_GOLD' });
    const account = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
    expect(account.balance).toBe(100n);
    expect(await prisma.currencyTransaction.count({ where: { accountId: account.id } })).toBe(1);
  });

  it('honors idempotency keys per namespace, even concurrently', async () => {
    const { characterId } = await setupCharacter();
    const change = {
      characterId,
      amount: 10n,
      type: CURRENCY_TYPES.TEST,
      operationNamespace: 'test-idem',
      idempotencyKey: 'op-000123',
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => prisma.$transaction((tx) => currency().debit(tx, change))),
    );
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    const account = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
    expect(account.balance).toBe(90n);

    // Same key in a different namespace applies independently.
    await prisma.$transaction((tx) =>
      currency().debit(tx, { ...change, operationNamespace: 'other-ns' }),
    );
    const after = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
    expect(after.balance).toBe(80n);
  });

  it('keeps the ledger chain consistent under concurrent changes', async () => {
    const { characterId } = await setupCharacter();
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        prisma.$transaction((tx) =>
          currency().credit(tx, {
            characterId,
            amount: BigInt(i + 1),
            type: CURRENCY_TYPES.TEST,
            operationNamespace: 'test-chain',
          }),
        ),
      ),
    );
    const account = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
    const entries = await prisma.currencyTransaction.findMany({
      where: { accountId: account.id },
      orderBy: { balanceAfter: 'asc' },
    });
    // Every entry: after = before + amount; total matches the balance.
    let sum = 0n;
    for (const entry of entries) {
      expect(entry.balanceAfter).toBe(entry.balanceBefore + entry.amount);
      sum += entry.amount;
    }
    expect(sum).toBe(account.balance);
    expect(account.balance).toBe(100n + 36n);
  });
});

describe('basis points', () => {
  it('floors integer tax math', () => {
    expect(applyBasisPoints(999n, 250)).toBe(24n); // floor(24.975)
    expect(applyBasisPoints(10_000n, 250)).toBe(250n);
    expect(applyBasisPoints(1n, 9999)).toBe(0n);
    expect(applyBasisPoints(0n, 500)).toBe(0n);
    expect(applyBasisPoints(100n, 10_500)).toBe(105n); // price multipliers may exceed 100%
    expect(() => applyBasisPoints(100n, 100_001)).toThrow();
    expect(() => applyBasisPoints(100n, -1)).toThrow();
  });
});

describe('Crownfall Inn', () => {
  it('rests only where an inn exists', async () => {
    const { auth } = await setupCharacter();
    // Move to the Market District (no inn there).
    const market = await prisma.location.findUniqueOrThrow({
      where: { slug: 'crownfall-market-district' },
    });
    await prisma.character.updateMany({ data: { currentLocationId: market.id } });
    await prisma.character.updateMany({ data: { currentHp: 1 } });

    const response = await rest(auth, 'rest-0001');
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('NO_INN_HERE');
  });

  it('restores HP/MP atomically with the level-scaled debit, exactly once per key', async () => {
    const { auth, characterId } = await setupCharacter();
    await prisma.character.update({
      where: { id: characterId },
      data: { currentHp: 10, currentMp: 2 },
    });

    const response = await rest(auth, 'rest-0002');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.feePaid).toBe('7'); // 5 + 2 * level 1
    expect(body.gold).toBe('93');
    expect(body.resources.hp).toBe(120);
    expect(body.resources.mp).toBe(20);

    // Ledger entry present and typed.
    const account = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
    const innEntries = await prisma.currencyTransaction.findMany({
      where: { accountId: account.id, type: CURRENCY_TYPES.INN_REST },
    });
    expect(innEntries).toHaveLength(1);
    expect(innEntries[0]!.amount).toBe(-7n);

    // Replaying the same idempotency key charges nothing more.
    const replay = await rest(auth, 'rest-0002');
    expect(replay.statusCode).toBe(200);
    expect(replay.json().gold).toBe('93');

    // Fully rested: a fresh rest attempt is rejected before charging.
    const wasteful = await rest(auth, 'rest-0003');
    expect(wasteful.statusCode).toBe(400);
    expect(wasteful.json().error.code).toBe('ALREADY_RESTED');
  });

  it('rejects the rest when Gold is insufficient, changing nothing', async () => {
    const { auth, characterId } = await setupCharacter();
    const account = await prisma.currencyAccount.findUniqueOrThrow({ where: { characterId } });
    await prisma.currencyAccount.update({ where: { id: account.id }, data: { balance: 3n } });
    await prisma.character.update({ where: { id: characterId }, data: { currentHp: 10 } });

    const response = await rest(auth, 'rest-0004');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INSUFFICIENT_GOLD');

    const after = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(after.currentHp).toBe(10); // no partial restoration
  });

  it('is unavailable while traveling', async () => {
    const { auth, characterId } = await setupCharacter();
    await prisma.character.update({ where: { id: characterId }, data: { currentHp: 10 } });
    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/travel/start',
      headers: { origin: TEST_ORIGIN, 'x-csrf-token': auth.csrf },
      cookies: { [SESSION_COOKIE]: auth.cookie },
      payload: { destinationSlug: 'north-road', idempotencyKey: 'trip-inn-1' },
    });
    expect(start.statusCode).toBe(200);
    const response = await rest(auth, 'rest-0005');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CURRENTLY_TRAVELING');
  });
});
