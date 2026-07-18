import { z } from 'zod';

/**
 * Environment contract for the API and worker processes. Validated once at
 * startup; the process refuses to start with an invalid configuration.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((v) => v.startsWith('postgresql://') || v.startsWith('postgres://'), {
      message: 'DATABASE_URL must be a postgresql:// connection string',
    }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Comma-separated list of origins allowed on state-changing requests. */
  ALLOWED_ORIGINS: z.string().min(1).default('http://localhost:5173,http://localhost:4173'),
  /** Chat send burst per account (token-bucket capacity). */
  CHAT_RATE_LIMIT_BURST: z.coerce.number().int().min(1).max(100).default(5),
  /** Sustained chat sends per minute per account. */
  CHAT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(20),
  /** Chat send burst per client IP (covers multiple accounts per IP). */
  CHAT_RATE_LIMIT_IP_BURST: z.coerce.number().int().min(1).max(200).default(10),
  /** Sustained chat sends per minute per client IP. */
  CHAT_RATE_LIMIT_IP_PER_MINUTE: z.coerce.number().int().min(1).max(1200).default(60),
  /**
   * Visible chat-message retention in days. Cleanup is best-effort worker
   * work; reported messages and all audit records are never deleted by it.
   */
  CHAT_RETENTION_DAYS: z.coerce.number().int().min(7).max(365).default(90),
  /** Recent-auth window (minutes) gating administrator mutations. */
  ADMIN_REAUTH_WINDOW_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  /** Reauth attempts per minute per IP (a password check; rate-limited). */
  ADMIN_REAUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(10),
  /**
   * Must be explicitly "true" for the admin bootstrap/promote CLI to run in
   * production. Disabled by default so no privilege change happens implicitly.
   */
  ADMIN_BOOTSTRAP_ENABLED: z.string().optional(),
  /**
   * Fastify proxy trust (Phase 18). "true"/"false", a hop count, or a
   * comma-separated subnet/IP list. Behind a reverse proxy this must be set so
   * request.ip (rate limiting) and secure-cookie detection are correct.
   */
  TRUST_PROXY: z.string().optional(),
  /** Send HSTS only when TLS is terminated ahead of the app ("true"). */
  ENABLE_HSTS: z.string().optional(),
  /**
   * Bearer token guarding the OpenMetrics endpoint. When unset the endpoint is
   * disabled (process metrics stay network-private); set it to allow scraping.
   */
  METRICS_TOKEN: z.string().optional(),
  /** Worker health probe port (liveness + recent pg-boss poll). 0 disables. */
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(0),
  /** Expired/revoked session retention in days before cleanup removes them. */
  SESSION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Read-notification retention in days before cleanup removes them. */
  NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Build/commit identifier surfaced in diagnostics (never a secret). */
  BUILD_VERSION: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Parses TRUST_PROXY into the value Fastify's `trustProxy` option expects. */
export function parseTrustProxy(value: string | undefined): boolean | number | string[] {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  const asNumber = Number(value);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
  return value.split(',').map((entry) => entry.trim());
}

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

/** Parses and validates environment variables. Throws EnvValidationError listing every problem. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new EnvValidationError(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
