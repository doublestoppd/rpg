import { createHash } from 'node:crypto';

/**
 * Deterministic JSON: object keys sorted recursively, arrays preserved in
 * order. Content payloads are canonicalized so export is byte-stable and a
 * checksum detects any change (Phase 19). BigInt is serialized as a decimal
 * string (ADR 0001); undefined is dropped.
 */
export function canonicalize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = canonicalize((value as Record<string, unknown>)[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return value;
}

/** Stable JSON string of a canonicalized value. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** SHA-256 checksum of a canonicalized payload. */
export function checksumOf(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
