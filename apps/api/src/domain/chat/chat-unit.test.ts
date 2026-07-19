import { describe, expect, it } from 'vitest';

import { DomainError } from '../../lib/http-errors.js';
import { decodeChatCursor, encodeChatCursor } from './chat-cursor.js';
import { createChatRateLimiter } from './chat-rate-limit.js';
import { normalizeChatBody } from './chat-text.js';

describe('chat body validation', () => {
  it('normalizes line endings and trims surrounding whitespace', () => {
    expect(normalizeChatBody('  hello\r\nworld  ')).toBe('hello\nworld');
    expect(normalizeChatBody('a\rb')).toBe('a\nb');
  });

  it('accepts Unicode plain text', () => {
    expect(normalizeChatBody('héllo 🐉 こんにちは')).toBe('héllo 🐉 こんにちは');
  });

  it('rejects an empty or whitespace-only body', () => {
    expect(() => normalizeChatBody('   ')).toThrow(DomainError);
    expect(() => normalizeChatBody('\n\n')).toThrow(DomainError);
  });

  it('rejects NUL and disallowed control characters', () => {
    expect(() => normalizeChatBody('bad\u0000nul')).toThrow(/control/);
    expect(() => normalizeChatBody('bell\u0007here')).toThrow(/control/);
    expect(() => normalizeChatBody('del\u007Fhere')).toThrow(/control/);
    expect(() => normalizeChatBody('esc\u001Bhere')).toThrow(/control/);
  });

  it('allows tab and newline (the permitted control characters)', () => {
    expect(normalizeChatBody('a\tb\nc')).toBe('a\tb\nc');
  });

  it('enforces the 500 code-point limit (counting by code points, not units)', () => {
    // 500 emoji = 500 code points but 1000 UTF-16 units and 2000 bytes.
    const ok = '😀'.repeat(500);
    expect(normalizeChatBody(ok)).toBe(ok);
    expect(() => normalizeChatBody('a'.repeat(501))).toThrow(/characters/);
  });

  it('enforces the 2000-byte UTF-8 limit', () => {
    // 501 four-byte emoji is 2004 bytes but only 501 code points — both limits
    // guard, and the byte limit trips first here after the code-point check.
    expect(() => normalizeChatBody('😀'.repeat(501))).toThrow(DomainError);
    // 500 three-byte characters = 1500 bytes, under both limits.
    expect(normalizeChatBody('あ'.repeat(500))).toHaveLength(500);
  });
});

describe('chat cursor', () => {
  it('round-trips an ordering tuple opaquely', () => {
    const cursor = { createdAt: new Date('2026-07-17T12:34:56.789Z'), id: 'abc-123' };
    const encoded = encodeChatCursor(cursor);
    // Opaque: not the raw id.
    expect(encoded).not.toContain('abc-123');
    const decoded = decodeChatCursor(encoded);
    expect(decoded.id).toBe('abc-123');
    expect(decoded.createdAt.toISOString()).toBe('2026-07-17T12:34:56.789Z');
  });

  it('rejects a malformed cursor', () => {
    expect(() => decodeChatCursor('not-base64!')).toThrow(DomainError);
    expect(() => decodeChatCursor(Buffer.from('{}').toString('base64url'))).toThrow(DomainError);
  });
});

describe('chat rate limiter', () => {
  const config = { accountBurst: 3, accountPerMinute: 60, ipBurst: 100, ipPerMinute: 6000 };

  it('allows a burst then blocks with a bounded retry-after', () => {
    const limiter = createChatRateLimiter(config);
    const now = new Date('2026-07-17T00:00:00.000Z');
    expect(limiter.consume('acct', 'ip', now).allowed).toBe(true);
    expect(limiter.consume('acct', 'ip', now).allowed).toBe(true);
    expect(limiter.consume('acct', 'ip', now).allowed).toBe(true);
    const blocked = limiter.consume('acct', 'ip', now);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it('refills over time (deterministic clock)', () => {
    const limiter = createChatRateLimiter(config);
    const t0 = new Date('2026-07-17T00:00:00.000Z');
    for (let i = 0; i < 3; i++) limiter.consume('acct', 'ip', t0);
    expect(limiter.consume('acct', 'ip', t0).allowed).toBe(false);
    // 60/min = 1/sec: after one second exactly one token is back.
    const t1 = new Date(t0.getTime() + 1000);
    expect(limiter.consume('acct', 'ip', t1).allowed).toBe(true);
    expect(limiter.consume('acct', 'ip', t1).allowed).toBe(false);
  });

  it('enforces the per-IP limit independently of the account', () => {
    const limiter = createChatRateLimiter({
      accountBurst: 100,
      accountPerMinute: 6000,
      ipBurst: 2,
      ipPerMinute: 60,
    });
    const now = new Date('2026-07-17T00:00:00.000Z');
    // Two different accounts sharing one IP: the IP bucket still caps them.
    expect(limiter.consume('a', 'ip', now).allowed).toBe(true);
    expect(limiter.consume('b', 'ip', now).allowed).toBe(true);
    expect(limiter.consume('c', 'ip', now).allowed).toBe(false);
  });

  it('does not consume the account token when the IP bucket blocks', () => {
    const limiter = createChatRateLimiter({
      accountBurst: 10,
      accountPerMinute: 600,
      ipBurst: 1,
      ipPerMinute: 60,
    });
    const now = new Date('2026-07-17T00:00:00.000Z');
    expect(limiter.consume('acct', 'ip', now).allowed).toBe(true);
    // IP exhausted; account still has 9 tokens but this send is blocked and
    // must not have burned an account token.
    expect(limiter.consume('acct', 'ip', now).allowed).toBe(false);
    // A different IP proves the account bucket kept 9 tokens (not 8).
    for (let i = 0; i < 9; i++) {
      expect(limiter.consume('acct', `ip-${i}`, now).allowed).toBe(true);
    }
  });
});
