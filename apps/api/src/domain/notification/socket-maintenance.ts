import type { PrismaClient } from '@prisma/client';

import type { LiveHub } from './live-hub.js';

/**
 * Periodic live-socket maintenance: heartbeats (terminating unresponsive
 * connections) and session revalidation (closing sockets whose backing
 * session was revoked or expired since the upgrade). Run on an interval by
 * the notifications module; exported separately so tests can drive one
 * sweep deterministically.
 */
export interface SocketMaintenance {
  sweep(now?: Date): Promise<void>;
}

export function createSocketMaintenance(prisma: PrismaClient, liveHub: LiveHub): SocketMaintenance {
  return {
    async sweep(now = new Date()) {
      liveHub.heartbeat();
      const sessionIds = liveHub.connectedSessionIds();
      if (sessionIds.length === 0) return;
      const dead = await prisma.session.findMany({
        where: {
          id: { in: sessionIds },
          OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }],
        },
        select: { id: true },
      });
      if (dead.length > 0) liveHub.closeSessions(new Set(dead.map((session) => session.id)));
    },
  };
}
