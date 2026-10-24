import { LLM_PROVIDER_NAMES, SEVERITIES } from '@apimon/shared';
import { z } from 'zod';

/**
 * The only module that reads `process.env` (§5.2). Everything else receives the parsed,
 * frozen `Env` through the container.
 */

/** Compose passes unset optional variables as "" — treat blank as undefined. */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = () => z.preprocess(blankToUndefined, z.string().trim().optional());

const requiredString = (name: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string({ error: `${name} is required` })
      .trim()
      .min(1),
  );

/** Never z.coerce.boolean(): it turns "false" into true. */
const bool = (defaultValue: 'true' | 'false') =>
  z.preprocess(
    blankToUndefined,
    z
      .enum(['true', 'false'], { error: 'must be "true" or "false"' })
      .default(defaultValue)
      .transform((value) => value === 'true'),
  );

const int = (defaultValue: number, min: number, max: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).default(defaultValue));

const optionalInt = (min: number, max: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).optional());

const secret = (name: string, minLength: number) =>
  z.preprocess(
    blankToUndefined,
    z
      .string({ error: `${name} is required` })
      .min(minLength, `${name} must be at least ${minLength} characters`),
  );

const commaList = (raw: string) =>
  raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const isExactOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
};

const corsOrigins = z.preprocess(
  blankToUndefined,
  z
    .string()
    .default('http://localhost:3000')
    .transform(commaList)
    .superRefine((origins, ctx) => {
      for (const origin of origins) {
        if (origin === '*') {
          ctx.addIssue({ code: 'custom', message: '"*" is not allowed; list exact origins' });
        } else if (!isExactOrigin(origin)) {
          ctx.addIssue({
            code: 'custom',
            message: `"${origin}" is not an origin (scheme://host[:port], no path, no trailing slash)`,
          });
        }
      }
    }),
);

const providerOrder = z.preprocess(
  blankToUndefined,
  z
    .string()
    .default(LLM_PROVIDER_NAMES.join(','))
    .transform(commaList)
    .pipe(z.array(z.enum(LLM_PROVIDER_NAMES, { error: `must be one of ${LLM_PROVIDER_NAMES.join(', ')}` }))),
);

const trustProxy = z.preprocess(
  blankToUndefined,
  z
    .string()
    .default('false')
    .transform((value, ctx): false | number => {
      if (value === 'false') return false;
      const hops = Number(value);
      if (Number.isInteger(hops) && hops > 0 && hops < 100) return hops;
      ctx.addIssue({ code: 'custom', message: 'must be "false" or a positive integer hop count' });
      return z.NEVER;
    }),
);

const bodySize = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(/^\d+(b|kb|mb)$/i, 'must look like 512kb or 1mb')
    .default('1mb'),
);

const envSchema = z
  .object({
    APP_ENV: z.preprocess(
      blankToUndefined,
      z.enum(['development', 'test', 'production']).default('development'),
    ),
    LOG_LEVEL: z.preprocess(
      blankToUndefined,
      z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    ),
    DEMO_MODE: bool('false'),
    PUBLIC_WEB_URL: z.preprocess(blankToUndefined, z.url().default('http://localhost:3000')),
    CORS_ALLOWED_ORIGINS: corsOrigins,
    TRUST_PROXY: trustProxy,

    PORT: optionalInt(1, 65535),
    MONITOR_API_PORT: optionalInt(1, 65535),

    DATABASE_URL: requiredString('DATABASE_URL'),
    REDIS_URL: requiredString('REDIS_URL'),

    JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET', 32),
    JWT_ISSUER: z.preprocess(blankToUndefined, z.string().min(1).default('apimon')),
    JWT_AUDIENCE: z.preprocess(blankToUndefined, z.string().min(1).default('apimon-client')),
    // A5: access tokens live at most 15 minutes.
    ACCESS_TOKEN_TTL_SECONDS: int(900, 60, 900),
    REFRESH_TOKEN_TTL_DAYS: int(7, 1, 90),
    COOKIE_SECURE: bool('false'),
    COOKIE_SAME_SITE: z.preprocess(blankToUndefined, z.enum(['strict', 'lax', 'none']).default('strict')),
    SEED_ADMIN_EMAIL: z.preprocess(blankToUndefined, z.email().trim().toLowerCase().optional()),
    SEED_ADMIN_PASSWORD: z.preprocess(
      blankToUndefined,
      z
        .string()
        .min(12, 'SEED_ADMIN_PASSWORD must be at least 12 characters')
        .max(128, 'SEED_ADMIN_PASSWORD must be at most 128 characters')
        .optional(),
    ),

    INGEST_API_KEY: secret('INGEST_API_KEY', 32),
    INTERNAL_SERVICE_KEY: secret('INTERNAL_SERVICE_KEY', 32),

    LATENCY_WARNING_MS: int(2000, 1, 600_000),
    LATENCY_CRITICAL_MS: int(5000, 1, 600_000),
    MAX_BATCH_SIZE: int(1000, 1, 10_000),
    MAX_BODY_SIZE: bodySize,

    AI_PROVIDER_ORDER: providerOrder,
    AI_TIMEOUT_MS: int(6000, 500, 60_000),
    AI_SYNC_WAIT_MS: int(5000, 0, 30_000),
    AI_SYNC_MAX_ALERTS: int(10, 0, 1000),
    AI_CACHE_TTL_SECONDS: int(86_400, 0, 30 * 86_400),
    AI_WORKER_CONCURRENCY: int(4, 1, 64),
    GEMINI_API_KEY: optionalString(),
    GEMINI_MODEL: optionalString(),
    OPENAI_API_KEY: optionalString(),
    OPENAI_MODEL: optionalString(),
    MISTRAL_API_KEY: optionalString(),
    MISTRAL_MODEL: optionalString(),

    // Off until a real SMTP server is configured (no local mail catcher ships with the stack).
    EMAIL_ENABLED: bool('false'),
    SMTP_HOST: optionalString(),
    SMTP_PORT: int(587, 1, 65535),
    SMTP_SECURE: bool('false'),
    SMTP_USER: optionalString(),
    SMTP_PASSWORD: optionalString(),
    EMAIL_FROM: z.preprocess(blankToUndefined, z.string().min(3).default('API Monitor <alerts@example.com>')),
    ALERT_EMAIL_TO: z.preprocess(blankToUndefined, z.string().min(3).default('oncall@example.com')),
    ALERT_EMAIL_MIN_SEVERITY: z.preprocess(blankToUndefined, z.enum(SEVERITIES).default('CRITICAL')),

    ALERT_AUTO_RESOLVE_MINUTES: int(30, 0, 10_080),
    TELEMETRY_RETENTION_DAYS: int(7, 1, 3650),

    SIMULATOR_URL: z.preprocess(blankToUndefined, z.url().default('http://localhost:4400')),
    SAMPLES_DIR: optionalString(),
    METRICS_TOKEN: z.preprocess(
      blankToUndefined,
      z.string().min(16, 'METRICS_TOKEN must be at least 16 characters').optional(),
    ),
  })
  .superRefine((env, ctx) => {
    if (env.LATENCY_CRITICAL_MS <= env.LATENCY_WARNING_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['LATENCY_CRITICAL_MS'],
        message: 'LATENCY_CRITICAL_MS must be greater than LATENCY_WARNING_MS',
      });
    }

    for (const provider of LLM_PROVIDER_NAMES) {
      const prefix = provider.toUpperCase() as Uppercase<typeof provider>;
      if (env[`${prefix}_API_KEY`] && !env[`${prefix}_MODEL`]) {
        ctx.addIssue({
          code: 'custom',
          path: [`${prefix}_MODEL`],
          message: `${prefix}_MODEL is required when ${prefix}_API_KEY is set`,
        });
      }
    }

    if (env.EMAIL_ENABLED && !env.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when EMAIL_ENABLED=true (e.g. smtp.gmail.com)',
      });
    }

    if (env.COOKIE_SAME_SITE === 'none' && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SAME_SITE'],
        message: 'COOKIE_SAME_SITE=none requires COOKIE_SECURE=true',
      });
    }

    if (env.APP_ENV !== 'production') return;

    // Production guards.
    if (env.DEMO_MODE) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEMO_MODE'],
        message: 'DEMO_MODE=true is forbidden in production',
      });
    }
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production',
      });
    }
    const secrets = {
      JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
      INGEST_API_KEY: env.INGEST_API_KEY,
      INTERNAL_SERVICE_KEY: env.INTERNAL_SERVICE_KEY,
      SEED_ADMIN_PASSWORD: env.SEED_ADMIN_PASSWORD,
      DATABASE_URL: env.DATABASE_URL,
      REDIS_URL: env.REDIS_URL,
      SMTP_PASSWORD: env.SMTP_PASSWORD,
      METRICS_TOKEN: env.METRICS_TOKEN,
    };
    for (const [name, value] of Object.entries(secrets)) {
      if (value?.includes('dev-only-')) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} still uses a dev-only- value; generate a real secret for production`,
        });
      }
    }
    for (const origin of env.CORS_ALLOWED_ORIGINS) {
      const url = new URL(origin);
      if (url.protocol === 'http:' && url.hostname !== 'localhost') {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ALLOWED_ORIGINS'],
          message: `${origin} must use https in production`,
        });
      }
    }
  })
  .transform((env) => ({
    ...env,
    /** Port the API listens on: PORT (containers) → MONITOR_API_PORT (host) → 3001. */
    API_PORT: env.PORT ?? env.MONITOR_API_PORT ?? 3001,
  }));

export type Env = Readonly<z.output<typeof envSchema>>;
export type EnvInput = Record<string, string | undefined>;

export class EnvValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/** Pure parser — used by tests and by `loadEnv`. Throws `EnvValidationError` listing every problem. */
export const parseEnv = (source: EnvInput): Env => {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return Object.freeze(result.data);
};

/** Parse `process.env` once at startup; print every problem in one message and exit 1 on failure. */
export const loadEnv = (): Env => {
  try {
    return parseEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // The logger is configured from the env, so it cannot exist yet.
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
};

/** AI providers whose key and model are both configured, in AI_PROVIDER_ORDER. */
export const configuredProviders = (env: Env) =>
  env.AI_PROVIDER_ORDER.filter((name) => {
    const prefix = name.toUpperCase() as Uppercase<typeof name>;
    return Boolean(env[`${prefix}_API_KEY`] && env[`${prefix}_MODEL`]);
  });
