/** Domain error carrying an HTTP status and a stable public code. */
export class DomainError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const unauthorized = (message = 'Authentication required.') =>
  new DomainError(401, 'UNAUTHORIZED', message);

export const invalidCredentials = () =>
  // Generic on purpose: never reveal whether the email exists.
  new DomainError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

export const forbidden = (code: string, message: string) => new DomainError(403, code, message);

export const conflict = (code: string, message: string) => new DomainError(409, code, message);

/** 429 with a bounded retry hint (surfaced as Retry-After + envelope field). */
export class RateLimitError extends DomainError {
  constructor(
    code: string,
    message: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(429, code, message);
    this.name = 'RateLimitError';
  }
}
