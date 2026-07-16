/**
 * Shared timed-state utility (ADR 0004).
 *
 * A timed state stores a completesAt timestamp and is logically complete the
 * moment it passes. Domains register finalizers here; every location-dependent
 * request runs them lazily before acting. Finalizers must be idempotent and
 * exactly-once in effect (conditional update or row lock inside their own
 * transaction). This is a small utility, not a workflow engine.
 */
export interface TimedStateFinalizer {
  /** Short domain name for logs. */
  readonly name: string;
  /** Finalizes any expired timed states owned by the character. Idempotent. */
  finalizeExpired(characterId: string, now: Date): Promise<void>;
}

export interface TimedStateRunner {
  /** Runs every registered finalizer for the character. */
  finalizeAll(characterId: string, now?: Date): Promise<void>;
}

export function createTimedStateRunner(finalizers: TimedStateFinalizer[]): TimedStateRunner {
  return {
    async finalizeAll(characterId, now = new Date()) {
      for (const finalizer of finalizers) {
        await finalizer.finalizeExpired(characterId, now);
      }
    },
  };
}
