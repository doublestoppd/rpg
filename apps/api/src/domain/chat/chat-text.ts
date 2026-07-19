import { CHAT_MESSAGE_MAX_BYTES, CHAT_MESSAGE_MAX_CODE_POINTS } from '@rpg/shared';

import { DomainError } from '../../lib/http-errors.js';

const invalidBody = (message: string) => new DomainError(400, 'INVALID_MESSAGE_BODY', message);

/**
 * Control characters rejected outright: every C0 control except newline and
 * tab (line endings are normalized to \n first), DEL, and the C1 range.
 * NUL is part of the C0 range.
 */
// eslint-disable-next-line no-control-regex
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;

/**
 * Normalizes and validates a chat message body:
 * line endings to \n, surrounding whitespace trimmed, Unicode plain text
 * with NUL/control characters rejected, 1-500 code points, <= 2000 UTF-8
 * bytes. The returned string is stored exactly as validated.
 */
export function normalizeChatBody(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, '\n').trim();
  if (normalized.length === 0) {
    throw invalidBody('Message is empty.');
  }
  if (DISALLOWED_CONTROL.test(normalized)) {
    throw invalidBody('Message contains disallowed control characters.');
  }
  const codePoints = [...normalized].length;
  if (codePoints > CHAT_MESSAGE_MAX_CODE_POINTS) {
    throw invalidBody(`Message exceeds ${CHAT_MESSAGE_MAX_CODE_POINTS} characters.`);
  }
  if (Buffer.byteLength(normalized, 'utf8') > CHAT_MESSAGE_MAX_BYTES) {
    throw invalidBody(`Message exceeds ${CHAT_MESSAGE_MAX_BYTES} bytes.`);
  }
  return normalized;
}
