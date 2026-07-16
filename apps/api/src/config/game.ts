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
});

export type GameConfig = z.infer<typeof gameConfigSchema>;

export const gameConfig: GameConfig = gameConfigSchema.parse({
  startingGold: 100n,
  staminaRegenPerInterval: 1,
  staminaRegenIntervalMs: 5 * 60 * 1000, // 1 stamina per 5 minutes
  innRestBaseFee: 5n,
  innRestFeePerLevel: 2n,
});
