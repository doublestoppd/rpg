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
});

export type Env = z.infer<typeof envSchema>;

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
