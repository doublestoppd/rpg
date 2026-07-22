import { useSyncExternalStore } from 'react';

/**
 * Shared, persisted "is chat pinned to the bottom of the screen" flag. The Chat
 * page toggles it; the app shell reads it to decide whether to mount the docked
 * chat panel on every page. Persisted to localStorage so the choice survives a
 * reload.
 */
const STORAGE_KEY = 'rpg.chat.pinned';

let pinned = readInitial();
const listeners = new Set<() => void>();

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setChatPinned(value: boolean): void {
  if (pinned === value) return;
  pinned = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    // Private-mode or disabled storage: the flag still works for this session.
  }
  for (const listener of listeners) listener();
}

export function toggleChatPinned(): void {
  setChatPinned(!pinned);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChatPinned(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => pinned,
    () => false,
  );
}
