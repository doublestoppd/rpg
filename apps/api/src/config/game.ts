import { z } from 'zod';

/**
 * Server-side game configuration. Validated at module load so a bad value
 * fails fast instead of corrupting gameplay math.
 */
const gameConfigSchema = z.object({
  /** Gold granted to a newly created character (BIGINT-safe integer). */
  startingGold: z.bigint().min(0n),
  /** Whole stamina points restored per interval. */
  staminaRegenPerInterval: z.number().int().min(1),
  /** Milliseconds per stamina regeneration interval. */
  staminaRegenIntervalMs: z.number().int().min(1000),
  /** Crownfall Inn rest fee: base + perLevel * character level (Gold). */
  innRestBaseFee: z.bigint().min(0n),
  innRestFeePerLevel: z.bigint().min(0n),
  /** Inventory slots per character (stacks + loose instances + reservations). */
  inventoryCapacity: z.number().int().min(1),
  /** Marketplace sales tax in basis points: floor(gross * bps / 10000). */
  marketTaxBps: z.number().int().min(0).max(10_000),
  /** Listing fee in basis points of the asking price (minimum 1 Gold). */
  listingFeeBps: z.number().int().min(0).max(10_000),
  /** Active listing lifetime in whole seconds. */
  listingDurationSeconds: z.number().int().min(60),
  /** Maximum listing price; must stay below Number.MAX_SAFE_INTEGER. */
  maxListingPrice: z
    .bigint()
    .min(1n)
    .refine((v) => v < BigInt(Number.MAX_SAFE_INTEGER), 'below MAX_SAFE_INTEGER'),
  /** Flat shipping fee for remote marketplace purchases (Gold). */
  shippingFee: z.bigint().min(0n),
  /** Remote delivery duration in whole seconds. */
  deliverySeconds: z.number().int().min(1),
});

export type GameConfig = z.infer<typeof gameConfigSchema>;

export const gameConfig: GameConfig = gameConfigSchema.parse({
  startingGold: 100n,
  staminaRegenPerInterval: 1,
  staminaRegenIntervalMs: 5 * 60 * 1000, // 1 stamina per 5 minutes
  innRestBaseFee: 5n,
  innRestFeePerLevel: 2n,
  inventoryCapacity: 24,
  marketTaxBps: 500,
  listingFeeBps: 200,
  listingDurationSeconds: 48 * 3600,
  maxListingPrice: 1_000_000_000n,
  shippingFee: 10n,
  deliverySeconds: 120,
});
