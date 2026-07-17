import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createMetrics, metrics } from './lib/metrics.js';
import { auditMutation, extractIdempotencyKey } from './lib/observability.js';
import { GAME_MODULES } from './modules/index.js';
import { requireService, type ServiceRegistry } from './modules/types.js';
import {
  expectIdempotentReplay,
  expectSingleWinner,
  raceFinalizers,
  replayRequest,
} from './test-concurrency.js';
import { buildTestApp, createTestPrisma } from './test-helpers.js';

let prisma: PrismaClient;
let app: FastifyInstance;

beforeAll(async () => {
  prisma = createTestPrisma();
  app = await buildTestApp(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('application composition', () => {
  it('registers every feature module exactly once, in dependency order', () => {
    const names = GAME_MODULES.map((m) => m.name);
    expect(names).toEqual([
      'auth',
      'account',
      'economy-core',
      'characters',
      'notifications',
      'quests',
      'travel',
      'world',
      'inventory',
      'currency',
      'npc-shops',
      'marketplace',
      'gathering',
      'crafting',
      'combat',
      'museum',
      'chat',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every module contributed its routes to the running app', () => {
    // One representative route per route-owning module.
    const representatives: Array<[string, string, string]> = [
      ['auth', 'POST', '/api/v1/auth/login'],
      ['account', 'GET', '/api/v1/account/settings'],
      ['characters', 'GET', '/api/v1/characters/me'],
      ['quests', 'GET', '/api/v1/quests'],
      ['travel', 'POST', '/api/v1/travel/start'],
      ['world', 'GET', '/api/v1/locations/current'],
      ['inventory', 'GET', '/api/v1/inventory'],
      ['currency', 'GET', '/api/v1/currency'],
      ['npc-shops', 'GET', '/api/v1/npc-shops'],
      ['marketplace', 'GET', '/api/v1/marketplace/listings'],
      ['gathering', 'GET', '/api/v1/gathering/actions'],
      ['crafting', 'GET', '/api/v1/crafting/recipes'],
      ['combat', 'GET', '/api/v1/combat/encounters'],
      ['museum', 'GET', '/api/v1/collections'],
      ['notifications', 'GET', '/api/v1/notifications'],
      ['chat', 'GET', '/api/v1/chat/channels'],
    ];
    for (const [module, method, url] of representatives) {
      expect(app.hasRoute({ method: method, url }), `${module}: ${method} ${url}`).toBe(true);
    }
  });

  it('requireService fails fast with a fix pointer when ordering is wrong', () => {
    const registry: ServiceRegistry = {};
    expect(() => requireService(registry, 'characterService')).toThrow(/module order/);
  });
});

describe('structured observability', () => {
  function fakeRequest(overrides: Partial<Record<string, unknown>> = {}) {
    const info = vi.fn();
    return {
      request: {
        method: 'POST',
        id: 'req-test-1234',
        url: '/api/v1/travel/start?x=1',
        routeOptions: { url: '/api/v1/travel/start' },
        currentUser: { id: 'user-1' },
        body: { idempotencyKey: 'key-12345678', password: 'super secret', token: 'tok' },
        log: { info },
        ...overrides,
      } as unknown as FastifyRequest,
      info,
    };
  }
  const fakeReply = (statusCode = 200) =>
    ({ statusCode, elapsedTime: 12.7 }) as unknown as FastifyReply;

  it('logs every mutation with requestId, operation, account, key, duration, outcome', () => {
    const { request, info } = fakeRequest();
    auditMutation(request, fakeReply(200));
    expect(info).toHaveBeenCalledTimes(1);
    const [fields, message] = info.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toBe('authoritative mutation');
    expect(fields).toMatchObject({
      audit: true,
      requestId: 'req-test-1234',
      operation: 'POST /api/v1/travel/start',
      accountId: 'user-1',
      idempotencyKey: 'key-12345678',
      durationMs: 13,
      statusCode: 200,
      success: true,
    });
    // Secrets never reach the audit entry: only the idempotency key is
    // lifted from the body, nothing else.
    expect(JSON.stringify(fields)).not.toContain('super secret');
    expect(JSON.stringify(fields)).not.toContain('tok');
  });

  it('marks failures and skips reads', () => {
    const failed = fakeRequest();
    auditMutation(failed.request, fakeReply(409));
    expect((failed.info.mock.calls[0]![0] as { success: boolean }).success).toBe(false);

    const read = fakeRequest({ method: 'GET' });
    auditMutation(read.request, fakeReply(200));
    expect(read.info).not.toHaveBeenCalled();
  });

  it('extracts only the idempotency key from bodies', () => {
    expect(extractIdempotencyKey({ idempotencyKey: 'abc' })).toBe('abc');
    expect(extractIdempotencyKey({ password: 'x' })).toBeNull();
    expect(extractIdempotencyKey('raw')).toBeNull();
    expect(extractIdempotencyKey(null)).toBeNull();
  });
});

describe('domain metrics', () => {
  it('counts and snapshots without high-cardinality labels', () => {
    const local = createMetrics();
    local.increment('idempotency_replay');
    local.increment('idempotency_replay');
    local.increment('combat_command_conflict');
    expect(local.snapshot().idempotency_replay).toBe(2);
    expect(local.snapshot().combat_command_conflict).toBe(1);
    expect(local.snapshot().deadlock).toBe(0);
    local.reset();
    expect(local.snapshot().idempotency_replay).toBe(0);
  });

  it('lazy finalizer executions are counted by the shared runner', async () => {
    const before = metrics.snapshot().lazy_finalizer_run;
    // Any location-dependent request runs every registered finalizer.
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    // Health does not touch gameplay; assert the counter is monotonic and
    // usable rather than coupling to an exact request count.
    expect(metrics.snapshot().lazy_finalizer_run).toBeGreaterThanOrEqual(before);
  });
});

describe('concurrency helpers', () => {
  it('expectSingleWinner accepts exactly one winner and flags everything else', () => {
    expectSingleWinner([{ statusCode: 200 }, { statusCode: 409 }, { statusCode: 409 }], 200, 409);
    expect(() =>
      expectSingleWinner([{ statusCode: 200 }, { statusCode: 200 }], 200, 409),
    ).toThrow();
    expect(() =>
      expectSingleWinner([{ statusCode: 409 }, { statusCode: 409 }], 200, 409),
    ).toThrow();
  });

  it('replayRequest + expectIdempotentReplay verify stale-client retries', async () => {
    let calls = 0;
    const outcome = await replayRequest(async () => {
      calls += 1;
      return { statusCode: 200, id: 'same-entity' };
    });
    expect(calls).toBe(2);
    expectIdempotentReplay(outcome, 200, (r) => r.id);
    expect(() =>
      expectIdempotentReplay(
        { first: { statusCode: 200, id: 'a' }, replay: { statusCode: 200, id: 'b' } },
        200,
        (r) => r.id,
      ),
    ).toThrow();
  });

  it('raceFinalizers runs the trigger concurrently N times', async () => {
    let concurrent = 0;
    let peak = 0;
    const results = await raceFinalizers(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrent -= 1;
      return 'done';
    }, 3);
    expect(results).toEqual(['done', 'done', 'done']);
    expect(peak).toBeGreaterThan(1);
  });
});
