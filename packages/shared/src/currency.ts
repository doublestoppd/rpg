import { z } from 'zod';

import { characterResourcesSchema } from './character.js';
import { idempotencyKeySchema } from './travel.js';

/** Gold amounts are decimal strings (BIGINT server-side, ADR 0001). */
export const goldStringSchema = z.string().regex(/^\d+$/);
export const signedGoldStringSchema = z.string().regex(/^-?\d+$/);

export const currencyBalanceResponseSchema = z.object({
  gold: goldStringSchema,
});
export type CurrencyBalanceResponse = z.infer<typeof currencyBalanceResponseSchema>;

export const currencyTransactionSchema = z.object({
  id: z.uuid(),
  /** Signed: credits positive, debits negative. */
  amount: signedGoldStringSchema,
  balanceAfter: goldStringSchema,
  type: z.string(),
  createdAt: z.iso.datetime(),
});
export type CurrencyTransactionInfo = z.infer<typeof currencyTransactionSchema>;

export const currencyTransactionsResponseSchema = z.object({
  transactions: z.array(currencyTransactionSchema),
});
export type CurrencyTransactionsResponse = z.infer<typeof currencyTransactionsResponseSchema>;

export const innRestRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});
export type InnRestRequest = z.infer<typeof innRestRequestSchema>;

export const innRestResponseSchema = z.object({
  feePaid: goldStringSchema,
  gold: goldStringSchema,
  resources: characterResourcesSchema,
});
export type InnRestResponse = z.infer<typeof innRestResponseSchema>;
