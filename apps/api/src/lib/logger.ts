import type { Env } from '../config/env.js';

/**
 * Structured JSON logging options for Fastify's built-in pino logger.
 * Secrets, cookies, and authorization values are always redacted.
 */
export function buildLoggerOptions(env: Env) {
  return {
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
  };
}
