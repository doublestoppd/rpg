import { DomainError } from '../../lib/http-errors.js';

/** Opaque keyset cursor for admin collections. Clients never interpret it. */
export function encodeCursor(value: Record<string, string>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) throw new Error('shape');
    return parsed as Record<string, string>;
  } catch {
    throw new DomainError(400, 'INVALID_CURSOR', 'The cursor is not valid.');
  }
}

/** Masks an email for minimized admin display: keeps only structural hints. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  const maskPart = (part: string | undefined) =>
    !part ? '***' : part.length <= 1 ? `${part}***` : `${part[0]}***`;
  const domainParts = (domain ?? '').split('.');
  const tld = domainParts.length > 1 ? domainParts[domainParts.length - 1] : '';
  return `${maskPart(local)}@${maskPart(domainParts[0])}${tld ? `.${tld}` : ''}`;
}
