import { describe, expect, it, vi } from 'vitest';

import { createLiveHub, type LiveSocket, MAX_BUFFERED_BYTES } from './live-hub.js';

interface FakeSocket extends LiveSocket {
  sent: string[];
  firePong: () => void;
  closeMock: ReturnType<typeof vi.fn>;
  terminateMock: ReturnType<typeof vi.fn>;
  pingMock: ReturnType<typeof vi.fn>;
}

/** A controllable fake socket implementing the narrow LiveSocket surface. */
function fakeSocket(overrides: Partial<LiveSocket> = {}): FakeSocket {
  const sent: string[] = [];
  const pongListeners: Array<() => void> = [];
  const closeMock = vi.fn();
  const terminateMock = vi.fn();
  const pingMock = vi.fn();
  const socket: FakeSocket = {
    readyState: 1,
    OPEN: 1,
    bufferedAmount: 0,
    sent,
    send: (data: string) => sent.push(data),
    close: closeMock,
    terminate: terminateMock,
    ping: pingMock,
    on: (_event: 'pong', listener: () => void) => {
      pongListeners.push(listener);
      return socket;
    },
    firePong: () => pongListeners.forEach((listener) => listener()),
    closeMock,
    terminateMock,
    pingMock,
    ...overrides,
  };
  return socket;
}

describe('live hub', () => {
  it('delivers a serialized envelope only to targeted characters', () => {
    const hub = createLiveHub();
    const a = fakeSocket();
    const b = fakeSocket();
    hub.add({ characterId: 'char-a', sessionId: 's-a', socket: a });
    hub.add({ characterId: 'char-b', sessionId: 's-b', socket: b });

    hub.send(['char-a'], '{"type":"chat.message.created"}');
    expect(a.sent).toEqual(['{"type":"chat.message.created"}']);
    expect(b.sent).toEqual([]);
  });

  it('still supports the legacy sync poke', () => {
    const hub = createLiveHub();
    const socket = fakeSocket();
    hub.add({ characterId: 'char-a', sessionId: 's-a', socket });
    hub.poke('char-a');
    expect(socket.sent).toEqual([JSON.stringify({ type: 'sync' })]);
  });

  it('disconnects a slow consumer instead of buffering without bound', () => {
    const hub = createLiveHub();
    const socket = fakeSocket({ bufferedAmount: MAX_BUFFERED_BYTES + 1 });
    hub.add({ characterId: 'char-a', sessionId: 's-a', socket });
    hub.send(['char-a'], 'payload');
    expect(socket.sent).toEqual([]);
    expect(socket.closeMock).toHaveBeenCalled();
    // The dropped connection no longer receives anything.
    expect(hub.count('char-a')).toBe(0);
  });

  it('closes every socket bound to a revoked session', () => {
    const hub = createLiveHub();
    const one = fakeSocket();
    const two = fakeSocket();
    const other = fakeSocket();
    hub.add({ characterId: 'char-a', sessionId: 'revoked', socket: one });
    hub.add({ characterId: 'char-a', sessionId: 'revoked', socket: two });
    hub.add({ characterId: 'char-b', sessionId: 'live', socket: other });

    hub.closeSessions(new Set(['revoked']));
    expect(one.closeMock).toHaveBeenCalled();
    expect(two.closeMock).toHaveBeenCalled();
    expect(other.closeMock).not.toHaveBeenCalled();
  });

  it('terminates sockets that miss a heartbeat but keeps responsive ones', () => {
    const hub = createLiveHub();
    const responsive = fakeSocket();
    const silent = fakeSocket();
    hub.add({ characterId: 'char-a', sessionId: 's-a', socket: responsive });
    hub.add({ characterId: 'char-b', sessionId: 's-b', socket: silent });

    // First sweep: ping both (marks them not-alive until a pong arrives).
    hub.heartbeat();
    expect(responsive.pingMock).toHaveBeenCalledTimes(1);
    expect(silent.pingMock).toHaveBeenCalledTimes(1);

    // Only the responsive one answers.
    responsive.firePong();

    // Second sweep: the silent socket is terminated; the responsive one pinged.
    hub.heartbeat();
    expect(silent.terminateMock).toHaveBeenCalled();
    expect(responsive.pingMock).toHaveBeenCalledTimes(2);
    expect(hub.count('char-a')).toBe(1);
    expect(hub.count('char-b')).toBe(0);
  });

  it('reports connected characters and sessions for fan-out and sweeps', () => {
    const hub = createLiveHub();
    hub.add({ characterId: 'char-a', sessionId: 's-a', socket: fakeSocket() });
    hub.add({ characterId: 'char-a', sessionId: 's-a2', socket: fakeSocket() });
    hub.add({ characterId: 'char-b', sessionId: 's-b', socket: fakeSocket() });

    expect(hub.connectedCharacterIds().sort()).toEqual(['char-a', 'char-b']);
    expect(hub.connectedSessionIds().sort()).toEqual(['s-a', 's-a2', 's-b']);
  });
});
