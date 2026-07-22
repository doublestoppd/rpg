import { useSyncExternalStore } from 'react';

/**
 * The quest the player has chosen to track in the top status bar. Persisted to
 * localStorage so the choice survives reloads. When unset, the status bar falls
 * back to the most relevant in-progress quest automatically.
 */
const STORAGE_KEY = 'rpg.quest.tracked';

let trackedId: string | null = readInitial();
const listeners = new Set<() => void>();

function readInitial(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setTrackedQuest(id: string | null): void {
  if (trackedId === id) return;
  trackedId = id;
  try {
    if (id === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage unavailable: the choice still holds for this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTrackedQuestId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => trackedId,
    () => null,
  );
}
