/**
 * Integer Gold arithmetic (ADR 0001). All amounts are BigInt; basis-point
 * rates use floor(gross * bps / 10000). No floating point, ever.
 */
export function applyBasisPoints(gross: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error(`applyBasisPoints: bps out of range: ${bps}`);
  }
  if (gross < 0n) throw new Error('applyBasisPoints: gross must be non-negative');
  return (gross * BigInt(bps)) / 10_000n; // BigInt division floors
}

/** Parses a decimal-string Gold amount into BigInt, rejecting garbage. */
export function parseGold(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`parseGold: not a decimal string: ${value}`);
  return BigInt(value);
}
