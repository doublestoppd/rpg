import { gameConfig } from '../../config/game.js';

/**
 * Crownfall Inn — service definition only.
 *
 * The Inn activates when locations exist (Phase 4) and the currency ledger
 * exists (Phase 7): resting restores full HP/MP for a level-scaled Gold fee,
 * charged through the currency service atomically with the restoration.
 * No endpoint exposes this yet.
 */

/** Level-scaled rest fee in Gold: base + perLevel * level. */
export function innRestFee(level: number): bigint {
  if (!Number.isInteger(level) || level < 1) {
    throw new Error('innRestFee: level must be a positive integer');
  }
  return gameConfig.innRestBaseFee + gameConfig.innRestFeePerLevel * BigInt(level);
}
