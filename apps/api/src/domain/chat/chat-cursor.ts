import { DomainError } from '../../lib/http-errors.js';

/**
 * Opaque, stable chat-history cursor. Encodes the deterministic ordering
 * tuple (createdAt, id); clients never construct or interpret it.
 */
export interface ChatCursor {
  createdAt: Date;
  id: string;
}

export function encodeChatCursor(cursor: ChatCursor): string {
  return Buffer.from(
    JSON.stringify({ t: cursor.createdAt.toISOString(), id: cursor.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeChatCursor(raw: string): ChatCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      t?: unknown;
      id?: unknown;
    };
    if (typeof parsed.t !== 'string' || typeof parsed.id !== 'string') throw new Error('shape');
    const createdAt = new Date(parsed.t);
    if (Number.isNaN(createdAt.getTime())) throw new Error('time');
    return { createdAt, id: parsed.id };
  } catch {
    throw new DomainError(400, 'INVALID_CURSOR', 'The chat cursor is not valid.');
  }
}
