import { createHash, randomBytes } from 'node:crypto';

/**
 * Session-token handling. The raw token lives only in the HttpOnly cookie;
 * PostgreSQL stores its SHA-256 hash, so a database leak cannot yield usable
 * session credentials.
 */

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}
