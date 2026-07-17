import type { Prisma } from '@prisma/client';

/**
 * Lightweight typed in-process domain events (Phase 13). Emitting services
 * call the sink inside the SAME transaction as their verified action, so
 * quest progress commits (or rolls back) atomically with the action itself.
 * This is deliberately not an event bus: synchronous, in-process, typed.
 */
export type QuestDomainEvent =
  | { type: 'TRAVEL_COMPLETED'; locationSlug: string }
  | {
      type: 'GATHERING_COMPLETED';
      actionSlug: string;
      rewards: Array<{ itemSlug: string; quantity: number }>;
    }
  | { type: 'CRAFTING_COMPLETED'; recipeSlug: string }
  | { type: 'COMBAT_VICTORY'; encounterSlug: string; defeatedEnemySlugs: string[] }
  | { type: 'MUSEUM_DONATION'; itemSlug: string };

export interface QuestEventSink {
  /** Applies the event to the character's active quests, inside `tx`. */
  handle(tx: Prisma.TransactionClient, characterId: string, event: QuestDomainEvent): Promise<void>;
}

/** Default sink for tests/bootstraps that do not wire quests. */
export const noopQuestEvents: QuestEventSink = {
  handle: async () => undefined,
};
