import type { WebSocket } from 'ws';

/**
 * In-process registry of live notification sockets per character. Sends only
 * a tiny {"type":"sync"} nudge — clients refetch over REST, which stays the
 * source of truth. Losing a socket (or never having one) costs nothing but
 * latency: polling covers it.
 */
export interface LiveHub {
  add(characterId: string, socket: WebSocket): void;
  remove(characterId: string, socket: WebSocket): void;
  poke(characterId: string): void;
  /** Open sockets for a character (for tests/metrics). */
  count(characterId: string): number;
}

export function createLiveHub(): LiveHub {
  const sockets = new Map<string, Set<WebSocket>>();
  return {
    add(characterId, socket) {
      const set = sockets.get(characterId) ?? new Set<WebSocket>();
      set.add(socket);
      sockets.set(characterId, set);
    },
    remove(characterId, socket) {
      const set = sockets.get(characterId);
      if (!set) return;
      set.delete(socket);
      if (set.size === 0) sockets.delete(characterId);
    },
    poke(characterId) {
      const set = sockets.get(characterId);
      if (!set) return;
      for (const socket of set) {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'sync' }));
        }
      }
    },
    count(characterId) {
      return sockets.get(characterId)?.size ?? 0;
    },
  };
}
