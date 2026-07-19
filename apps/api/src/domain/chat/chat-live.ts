import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import type { ChatMessageCreatedEvent } from '@rpg/shared';
import pg from 'pg';
import { z } from 'zod';

import { metrics } from '../../lib/metrics.js';
import type { LiveHub } from '../notification/live-hub.js';

/** PostgreSQL NOTIFY channel for cross-instance chat fan-out. */
export const CHAT_NOTIFY_CHANNEL = 'chat_events';

/** What a committed chat message publishes. Small identifiers only. */
export interface ChatLivePublishInput {
  channelId: string;
  messageId: string;
  authorCharacterId: string;
  occurredAt: string;
}

/** The NOTIFY payload: identifiers only, never message text. */
const notifyPayloadSchema = z.object({
  eventId: z.uuid(),
  channelId: z.uuid(),
  messageId: z.uuid(),
  authorCharacterId: z.uuid(),
  occurredAt: z.iso.datetime(),
  /** Originating API instance; the origin skips its own notifications. */
  origin: z.uuid(),
});

/**
 * Best-effort real-time chat delivery. PostgreSQL rows are authoritative;
 * this layer only pushes tiny `chat.message.created` invalidations to
 * authorized local sockets and relays them across API instances through
 * LISTEN/NOTIFY after commit. Every failure mode (socket loss, listener
 * downtime, dropped notifications) is repaired by client polling — NOTIFY
 * is never storage and never required for correctness.
 */
export interface ChatLive {
  /** Local fan-out + cross-instance NOTIFY for a COMMITTED message. */
  publish(input: ChatLivePublishInput): Promise<void>;
  /**
   * Starts the LISTEN connection (reconnects with backoff on failure).
   * Resolves after the first attempt; never rejects — a dead listener only
   * costs cross-instance latency.
   */
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ChatLiveOptions {
  /** Initial reconnect delay (doubles up to 30s). Tests may shrink it. */
  reconnectDelayMs?: number;
}

export function createChatLive(
  prisma: PrismaClient,
  liveHub: LiveHub,
  databaseUrl: string,
  options: ChatLiveOptions = {},
): ChatLive {
  const instanceId = randomUUID();
  const baseDelayMs = options.reconnectDelayMs ?? 1000;
  let delayMs = baseDelayMs;
  let client: pg.Client | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let hasConnectedBefore = false;

  /** Pushes the invalidation to authorized, non-blocking local sockets. */
  async function deliverLocal(event: ChatMessageCreatedEvent, authorCharacterId: string) {
    const connected = liveHub.connectedCharacterIds();
    if (connected.length === 0) return;
    const channel = await prisma.chatChannel.findUnique({ where: { id: event.channelId } });
    if (!channel) return;
    // The server decides delivery: location membership for LOCATION channels,
    // and characters who blocked the author never receive the invalidation.
    const eligible = await prisma.character.findMany({
      where: {
        id: { in: connected },
        ...(channel.kind === 'LOCATION' ? { currentLocationId: channel.locationId } : {}),
        chatBlocksMade: { none: { blockedCharacterId: authorCharacterId } },
      },
      select: { id: true },
    });
    liveHub.send(
      eligible.map((row) => row.id),
      JSON.stringify(event),
    );
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delayMs);
    delayMs = Math.min(delayMs * 2, 30_000);
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    const candidate = new pg.Client({ connectionString: databaseUrl });
    candidate.on('error', () => {
      // The 'end' handler owns reconnection; this only prevents an
      // unhandled 'error' event from crashing the process.
    });
    candidate.on('end', () => {
      if (client === candidate) client = null;
      scheduleReconnect();
    });
    candidate.on('notification', (message) => {
      if (message.channel !== CHAT_NOTIFY_CHANNEL || !message.payload) return;
      let parsed: z.infer<typeof notifyPayloadSchema>;
      try {
        parsed = notifyPayloadSchema.parse(JSON.parse(message.payload));
      } catch {
        return; // malformed payloads are ignored; polling covers everything
      }
      if (parsed.origin === instanceId) return; // already delivered locally
      void deliverLocal(
        {
          type: 'chat.message.created',
          eventId: parsed.eventId,
          channelId: parsed.channelId,
          messageId: parsed.messageId,
          occurredAt: parsed.occurredAt,
        },
        parsed.authorCharacterId,
      ).catch(() => undefined);
    });
    try {
      await candidate.connect();
      await candidate.query(`LISTEN ${CHAT_NOTIFY_CHANNEL}`);
      client = candidate;
      delayMs = baseDelayMs;
      if (hasConnectedBefore) metrics.increment('chat_listener_reconnect');
      hasConnectedBefore = true;
    } catch {
      void candidate.end().catch(() => undefined);
      scheduleReconnect();
    }
  }

  return {
    async publish(input) {
      const event: ChatMessageCreatedEvent = {
        type: 'chat.message.created',
        eventId: randomUUID(),
        channelId: input.channelId,
        messageId: input.messageId,
        occurredAt: input.occurredAt,
      };
      // Local sockets first (does not depend on the listener), then the
      // cross-instance notification. Both are best-effort by design.
      try {
        await deliverLocal(event, input.authorCharacterId);
      } catch {
        // Local delivery failed: polling repairs it.
      }
      try {
        const payload = JSON.stringify({
          ...event,
          authorCharacterId: input.authorCharacterId,
          origin: instanceId,
        });
        await prisma.$queryRaw`SELECT pg_notify(${CHAT_NOTIFY_CHANNEL}, ${payload})`;
      } catch {
        // NOTIFY failed: other instances fall back to client polling.
      }
    },

    async start() {
      await connect();
    },

    async stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const current = client;
      client = null;
      if (current) await current.end().catch(() => undefined);
    },
  };
}
