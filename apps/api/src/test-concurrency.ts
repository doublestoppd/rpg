import { expect } from 'vitest';

/**
 * Reusable concurrency-testing helpers (Phase 13B). Small and specific to
 * this project's invariants — duplicate requests, replays, races between
 * concurrent transactions — not a generic framework. Integration tests keep
 * running against real PostgreSQL so locking behavior is actually exercised.
 */

export interface RaceResponse {
  statusCode: number;
}

/** Fires every request factory concurrently and returns the responses. */
export async function raceRequests<T extends RaceResponse>(
  factories: Array<() => Promise<T>>,
): Promise<T[]> {
  return Promise.all(factories.map((factory) => factory()));
}

/**
 * Asserts a race had exactly one winner: one response with `winnerStatus`,
 * every other with `loserStatus`. Returns them split for further assertions.
 */
export function expectSingleWinner<T extends RaceResponse>(
  responses: T[],
  winnerStatus: number,
  loserStatus: number,
): { winner: T; losers: T[] } {
  const winners = responses.filter((r) => r.statusCode === winnerStatus);
  const losers = responses.filter((r) => r.statusCode === loserStatus);
  expect(
    responses.map((r) => r.statusCode).sort((a, b) => a - b),
    `expected exactly one ${winnerStatus} and ${responses.length - 1}× ${loserStatus}`,
  ).toEqual(
    [winnerStatus, ...Array<number>(responses.length - 1).fill(loserStatus)].sort((a, b) => a - b),
  );
  return { winner: winners[0] as T, losers };
}

/**
 * Replays the same request twice sequentially (the stale-client pattern:
 * a retry after the original already succeeded). Returns both responses.
 */
export async function replayRequest<T extends RaceResponse>(
  factory: () => Promise<T>,
): Promise<{ first: T; replay: T }> {
  const first = await factory();
  const replay = await factory();
  return { first, replay };
}

/**
 * Asserts an idempotent replay: both attempts succeed with `status` and,
 * given an extractor, resolve to the same entity.
 */
export function expectIdempotentReplay<T extends RaceResponse>(
  outcome: { first: T; replay: T },
  status: number,
  entityId?: (response: T) => string,
): void {
  expect(outcome.first.statusCode).toBe(status);
  expect(outcome.replay.statusCode).toBe(status);
  if (entityId) {
    expect(entityId(outcome.replay)).toBe(entityId(outcome.first));
  }
}

/**
 * Runs the same finalization trigger concurrently N times (the worker vs
 * lazy-finalizer race) and returns the results; callers then assert the
 * effect happened exactly once (a single grant, one ledger entry, …).
 */
export async function raceFinalizers<T>(trigger: () => Promise<T>, times = 2): Promise<T[]> {
  return Promise.all(Array.from({ length: times }, () => trigger()));
}
