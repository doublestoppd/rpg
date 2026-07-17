import { useSyncExternalStore } from 'react';

/**
 * Tiny shared store for the app-wide live socket's connection state. The nav
 * owns the single socket (useLiveSocket); pages read this to show a truthful
 * "live vs. polling-fallback" hint. Polling is always active regardless, so
 * this is informational only.
 */
let connected = false;
const listeners = new Set<() => void>();

export function setLiveSocketConnected(value: boolean): void {
  if (connected === value) return;
  connected = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLiveSocketConnected(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => connected,
    () => false,
  );
}
