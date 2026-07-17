/**
 * Chat send rate limiting: token buckets per account and per client IP,
 * with a small burst capacity and a sustained per-minute refill. Process-
 * local by design (mirrors the Phase 2 auth limiter); the clock is
 * injectable so tests are deterministic.
 */

export interface ChatRateLimitConfig {
  accountBurst: number;
  accountPerMinute: number;
  ipBurst: number;
  ipPerMinute: number;
}

export type ChatRateLimitDecision =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface ChatRateLimiter {
  /** Consumes one send from both buckets, or reports the earliest retry. */
  consume(accountKey: string, ipKey: string, now?: Date): ChatRateLimitDecision;
}

interface Bucket {
  tokens: number;
  updatedAtMs: number;
}

const MAX_RETRY_AFTER_SECONDS = 60;

export function createChatRateLimiter(config: ChatRateLimitConfig): ChatRateLimiter {
  const accounts = new Map<string, Bucket>();
  const ips = new Map<string, Bucket>();

  function take(
    store: Map<string, Bucket>,
    key: string,
    burst: number,
    perMinute: number,
    nowMs: number,
  ): { ok: boolean; retryAfterSeconds: number } {
    const refillPerMs = perMinute / 60_000;
    const bucket = store.get(key) ?? { tokens: burst, updatedAtMs: nowMs };
    bucket.tokens = Math.min(burst, bucket.tokens + (nowMs - bucket.updatedAtMs) * refillPerMs);
    bucket.updatedAtMs = nowMs;
    store.set(key, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true, retryAfterSeconds: 0 };
    }
    const waitMs = (1 - bucket.tokens) / refillPerMs;
    return {
      ok: false,
      retryAfterSeconds: Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(waitMs / 1000))),
    };
  }

  return {
    consume(accountKey, ipKey, now = new Date()) {
      const nowMs = now.getTime();
      const account = take(
        accounts,
        accountKey,
        config.accountBurst,
        config.accountPerMinute,
        nowMs,
      );
      const ip = take(ips, ipKey, config.ipBurst, config.ipPerMinute, nowMs);
      if (account.ok && ip.ok) return { allowed: true };
      // A send blocked by either bucket must not consume the other: refund.
      if (account.ok) accounts.get(accountKey)!.tokens += 1;
      if (ip.ok) ips.get(ipKey)!.tokens += 1;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(account.retryAfterSeconds, ip.retryAfterSeconds),
      };
    },
  };
}
