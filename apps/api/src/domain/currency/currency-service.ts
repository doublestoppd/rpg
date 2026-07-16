import type { CurrencyTransaction, Prisma, PrismaClient } from '@prisma/client';
import type { CurrencyBalanceResponse, CurrencyTransactionsResponse } from '@rpg/shared';

import { DomainError } from '../../lib/http-errors.js';

type Tx = Prisma.TransactionClient;

export const CURRENCY_TYPES = {
  STARTING_GRANT: 'STARTING_GRANT',
  INN_REST: 'INN_REST',
  TEST: 'TEST',
} as const;

export const insufficientGold = () =>
  new DomainError(409, 'INSUFFICIENT_GOLD', 'You cannot afford that.');

export interface CurrencyChange {
  characterId: string;
  /** Positive integer amount of Gold. */
  amount: bigint;
  /** Stable operation type for the ledger entry. */
  type: string;
  /** Idempotency scope; keys are unique per account and namespace. */
  operationNamespace: string;
  idempotencyKey?: string | undefined;
  relatedType?: string | undefined;
  relatedId?: string | undefined;
}

export interface CurrencyChangeResult {
  transaction: CurrencyTransaction;
  /** False when an idempotency key matched an existing entry (not reapplied). */
  applied: boolean;
}

export interface CurrencyService {
  /** Creates the character's account with the starting balance + ledger entry. */
  createAccount(tx: Tx, characterId: string, startingBalance: bigint): Promise<void>;
  /**
   * Credits Gold inside the caller's transaction. Locks the account row,
   * honors idempotency keys, and writes exactly one immutable ledger entry.
   */
  credit(tx: Tx, change: CurrencyChange): Promise<CurrencyChangeResult>;
  /** Debits Gold; rejects any change that would make the balance negative. */
  debit(tx: Tx, change: CurrencyChange): Promise<CurrencyChangeResult>;
  getBalance(characterId: string): Promise<CurrencyBalanceResponse>;
  getTransactions(characterId: string, limit?: number): Promise<CurrencyTransactionsResponse>;
}

export function createCurrencyService(prisma: PrismaClient): CurrencyService {
  /** Locks the account row so concurrent changes serialize (ADR 0003). */
  async function lockAccount(tx: Tx, characterId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string; balance: bigint }>>`
      SELECT "id", "balance" FROM "CurrencyAccount"
      WHERE "characterId" = ${characterId} FOR UPDATE`;
    const account = rows[0];
    if (!account) {
      throw new DomainError(500, 'NO_ACCOUNT', 'Currency account is missing.');
    }
    return account;
  }

  async function applyChange(tx: Tx, change: CurrencyChange, sign: 1n | -1n) {
    if (change.amount <= 0n) {
      throw new DomainError(400, 'INVALID_AMOUNT', 'Amount must be a positive integer.');
    }
    const account = await lockAccount(tx, change.characterId);

    // Idempotency: an existing entry for this namespace+key wins; nothing is
    // reapplied. (Checked under the account lock, so replays serialize.)
    if (change.idempotencyKey) {
      const existing = await tx.currencyTransaction.findUnique({
        where: {
          accountId_operationNamespace_idempotencyKey: {
            accountId: account.id,
            operationNamespace: change.operationNamespace,
            idempotencyKey: change.idempotencyKey,
          },
        },
      });
      if (existing) return { transaction: existing, applied: false };
    }

    const signedAmount = change.amount * sign;
    const balanceBefore = account.balance;
    const balanceAfter = balanceBefore + signedAmount;
    if (balanceAfter < 0n) throw insufficientGold();

    await tx.currencyAccount.update({
      where: { id: account.id },
      data: { balance: balanceAfter },
    });
    const transaction = await tx.currencyTransaction.create({
      data: {
        accountId: account.id,
        amount: signedAmount,
        balanceBefore,
        balanceAfter,
        type: change.type,
        operationNamespace: change.operationNamespace,
        idempotencyKey: change.idempotencyKey ?? null,
        relatedType: change.relatedType ?? null,
        relatedId: change.relatedId ?? null,
      },
    });
    return { transaction, applied: true };
  }

  return {
    async createAccount(tx, characterId, startingBalance) {
      const account = await tx.currencyAccount.create({
        data: { characterId, balance: startingBalance },
      });
      if (startingBalance > 0n) {
        await tx.currencyTransaction.create({
          data: {
            accountId: account.id,
            amount: startingBalance,
            balanceBefore: 0n,
            balanceAfter: startingBalance,
            type: CURRENCY_TYPES.STARTING_GRANT,
            operationNamespace: 'character-creation',
          },
        });
      }
    },

    credit: (tx, change) => applyChange(tx, change, 1n),
    debit: (tx, change) => applyChange(tx, change, -1n),

    async getBalance(characterId) {
      const account = await prisma.currencyAccount.findUnique({ where: { characterId } });
      return { gold: (account?.balance ?? 0n).toString() };
    },

    async getTransactions(characterId, limit = 20) {
      const account = await prisma.currencyAccount.findUnique({ where: { characterId } });
      if (!account) return { transactions: [] };
      const rows = await prisma.currencyTransaction.findMany({
        where: { accountId: account.id },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
      });
      return {
        transactions: rows.map((row) => ({
          id: row.id,
          amount: row.amount.toString(),
          balanceAfter: row.balanceAfter.toString(),
          type: row.type,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },
  };
}
