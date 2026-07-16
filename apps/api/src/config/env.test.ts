import { describe, expect, it } from 'vitest';

import { EnvValidationError, loadEnv } from './env.js';

describe('environment validation', () => {
  it('accepts a valid environment and applies defaults', () => {
    const env = loadEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => loadEnv({})).toThrow(EnvValidationError);
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://u:p@localhost/db' })).toThrow(/postgresql:\/\//);
  });

  it('rejects an invalid PORT and reports every issue', () => {
    const attempt = () =>
      loadEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db', PORT: 'abc', LOG_LEVEL: 'x' });
    expect(attempt).toThrow(EnvValidationError);
    expect(attempt).toThrow(/PORT/);
    expect(attempt).toThrow(/LOG_LEVEL/);
  });
});
