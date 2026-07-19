import { metrics } from '../../lib/metrics.js';

/**
 * The subset of `ws.WebSocket` the hub uses. Narrow on purpose: backpressure
 * and disconnect behavior are testable with fake sockets.
 */
export interface LiveSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  readonly OPEN: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  on(event: 'pong', listener: () => void): unknown;
}

export interface LiveConnection {
  characterId: string;
  sessionId: string;
  socket: LiveSocket;
}

/**
 * A slow consumer whose outbound queue exceeds this many bytes is
 * disconnected instead of growing process memory without bound.
 */
export const MAX_BUFFERED_BYTES = 64 * 1024;

/** Close code for server-initiated policy disconnects. */
const POLICY_CLOSE = 1008;

/**
 * In-process registry of live sockets per character (the Phase 15 transport,
 * extended for chat). Pushes only tiny invalidation events — clients refetch
 * over REST, which stays the source of truth. Losing a socket (or never
 * having one) costs nothing but latency: polling covers it.
 */
export interface LiveHub {
  add(connection: LiveConnection): void;
  remove(socket: LiveSocket): void;
  /** Legacy Phase 15 nudge: {"type":"sync"} to one character's sockets. */
  poke(characterId: string): void;
  /** Sends a serialized envelope event to each listed character's sockets. */
  send(characterIds: readonly string[], payload: string): void;
  /** Characters with at least one open socket (for fan-out eligibility). */
  connectedCharacterIds(): string[];
  /** Session ids with at least one open socket (for revocation sweeps). */
  connectedSessionIds(): string[];
  /** Closes every socket bound to one of these sessions. */
  closeSessions(sessionIds: ReadonlySet<string>): void;
  /** Pings every socket; terminates those that missed the previous ping. */
  heartbeat(): void;
  /** Open sockets for a character (for tests/metrics). */
  count(characterId: string): number;
}

interface TrackedConnection extends LiveConnection {
  isAlive: boolean;
}

export function createLiveHub(): LiveHub {
  const connections = new Map<LiveSocket, TrackedConnection>();

  function drop(connection: TrackedConnection, reason: string): void {
    metrics.increment('chat_socket_disconnect');
    connections.delete(connection.socket);
    try {
      connection.socket.close(POLICY_CLOSE, reason);
    } catch {
      connection.socket.terminate();
    }
  }

  function deliver(connection: TrackedConnection, payload: string): void {
    const { socket } = connection;
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      // Slow consumer: disconnect instead of queueing without bound. The
      // client reconnects and polling repairs anything missed meanwhile.
      drop(connection, 'slow consumer');
      return;
    }
    socket.send(payload);
  }

  return {
    add(connection) {
      const tracked: TrackedConnection = { ...connection, isAlive: true };
      connection.socket.on('pong', () => {
        tracked.isAlive = true;
      });
      connections.set(connection.socket, tracked);
    },

    remove(socket) {
      connections.delete(socket);
    },

    poke(characterId) {
      for (const connection of connections.values()) {
        if (connection.characterId === characterId) {
          deliver(connection, JSON.stringify({ type: 'sync' }));
        }
      }
    },

    send(characterIds, payload) {
      if (characterIds.length === 0) return;
      const targets = new Set(characterIds);
      for (const connection of connections.values()) {
        if (targets.has(connection.characterId)) deliver(connection, payload);
      }
    },

    connectedCharacterIds() {
      return [...new Set([...connections.values()].map((c) => c.characterId))];
    },

    connectedSessionIds() {
      return [...new Set([...connections.values()].map((c) => c.sessionId))];
    },

    closeSessions(sessionIds) {
      for (const connection of [...connections.values()]) {
        if (sessionIds.has(connection.sessionId)) drop(connection, 'session ended');
      }
    },

    heartbeat() {
      for (const connection of [...connections.values()]) {
        if (!connection.isAlive) {
          metrics.increment('chat_socket_disconnect');
          connections.delete(connection.socket);
          connection.socket.terminate();
          continue;
        }
        connection.isAlive = false;
        try {
          connection.socket.ping();
        } catch {
          connections.delete(connection.socket);
          connection.socket.terminate();
        }
      }
    },

    count(characterId) {
      let total = 0;
      for (const connection of connections.values()) {
        if (connection.characterId === characterId) total += 1;
      }
      return total;
    },
  };
}
