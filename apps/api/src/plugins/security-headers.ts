import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { Env } from '../config/env.js';

interface SecurityHeadersOptions {
  env: Env;
}

/**
 * Production security headers (Phase 18). Conservative defaults appropriate to
 * a JSON API plus a separately served static React app:
 *
 * - Content-Security-Policy with no dynamic script execution. The API returns
 *   JSON, so a strict default-src 'none' with frame-ancestors 'none' is safe;
 *   the static web bundle is served by its own host/CDN with its own CSP.
 * - HSTS only when TLS is verified ahead of the app (ENABLE_HSTS=true), so a
 *   plain-HTTP dev/preview never pins HSTS.
 * - X-Content-Type-Options: nosniff, X-Frame-Options: DENY, and a conservative
 *   Referrer-Policy on every response.
 *
 * No stack traces or internal errors are ever emitted here — the app error
 * handler already redacts those in production.
 */
export const securityHeadersPlugin = fp<SecurityHeadersOptions>(
  async (app: FastifyInstance, opts) => {
    const hsts = opts.env.ENABLE_HSTS === 'true';
    app.addHook('onSend', async (_request, reply, payload) => {
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Frame-Options', 'DENY');
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      // API responses are never a document to embed; forbid it explicitly.
      reply.header('Cross-Origin-Resource-Policy', 'same-origin');
      if (hsts) {
        reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
      return payload;
    });
  },
  { name: 'security-headers' },
);
