import { describe, expect, it } from 'vitest';
import { configuredProviders, EnvValidationError, parseEnv } from '../../src/config/env';
import { BASE_ENV, makeEnv } from '../helpers/env-fixtures';

const problemsOf = (overrides: Record<string, string | undefined>): string[] => {
  try {
    parseEnv({ ...BASE_ENV, ...overrides });
    return [];
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems;
    throw error;
  }
};

describe('env: booleans', () => {
  it('parses "false" as false (never z.coerce.boolean)', () => {
    expect(makeEnv({ DEMO_MODE: 'false' }).DEMO_MODE).toBe(false);
    expect(makeEnv({ EMAIL_ENABLED: 'false' }).EMAIL_ENABLED).toBe(false);
  });

  it('parses "true" as true', () => {
    expect(makeEnv({ DEMO_MODE: 'true' }).DEMO_MODE).toBe(true);
  });

  it('treats blank strings as unset (Compose passes "" for unset vars)', () => {
    const env = makeEnv({ DEMO_MODE: '', EMAIL_ENABLED: '  ', GEMINI_API_KEY: '', SMTP_HOST: '' });
    expect(env.DEMO_MODE).toBe(false);
    expect(env.EMAIL_ENABLED).toBe(false);
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.SMTP_HOST).toBeUndefined();
  });

  it('rejects anything that is not "true"/"false"', () => {
    expect(problemsOf({ DEMO_MODE: 'yes' }).join()).toMatch(/DEMO_MODE/);
    expect(problemsOf({ COOKIE_SECURE: '1' }).join()).toMatch(/COOKIE_SECURE/);
  });
});

describe('env: email', () => {
  it('is off by default and needs no SMTP server then', () => {
    const env = makeEnv({ EMAIL_ENABLED: undefined, SMTP_HOST: undefined });
    expect(env.EMAIL_ENABLED).toBe(false);
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.SMTP_PORT).toBe(587);
  });

  it('requires SMTP_HOST when EMAIL_ENABLED=true', () => {
    expect(problemsOf({ EMAIL_ENABLED: 'true', SMTP_HOST: '' }).join()).toMatch(/SMTP_HOST is required/);
    expect(makeEnv({ EMAIL_ENABLED: 'true', SMTP_HOST: 'smtp.gmail.com' }).SMTP_HOST).toBe('smtp.gmail.com');
  });
});

describe('env: numbers and lists', () => {
  it('coerces integers within bounds', () => {
    const env = makeEnv({ LATENCY_WARNING_MS: '1500', LATENCY_CRITICAL_MS: '4000', MAX_BATCH_SIZE: '50' });
    expect(env.LATENCY_WARNING_MS).toBe(1500);
    expect(env.MAX_BATCH_SIZE).toBe(50);
    expect(problemsOf({ MAX_BATCH_SIZE: '0' }).join()).toMatch(/MAX_BATCH_SIZE/);
    expect(problemsOf({ AI_TIMEOUT_MS: '2.5' }).join()).toMatch(/AI_TIMEOUT_MS/);
  });

  it('requires LATENCY_CRITICAL_MS > LATENCY_WARNING_MS', () => {
    expect(problemsOf({ LATENCY_WARNING_MS: '5000', LATENCY_CRITICAL_MS: '5000' }).join()).toMatch(
      /LATENCY_CRITICAL_MS must be greater/,
    );
  });

  it('caps the access token TTL at 15 minutes (A5)', () => {
    expect(problemsOf({ ACCESS_TOKEN_TTL_SECONDS: '3600' }).join()).toMatch(/ACCESS_TOKEN_TTL_SECONDS/);
  });

  it('parses AI_PROVIDER_ORDER and rejects unknown names', () => {
    expect(makeEnv({ AI_PROVIDER_ORDER: 'openai, gemini' }).AI_PROVIDER_ORDER).toEqual(['openai', 'gemini']);
    expect(problemsOf({ AI_PROVIDER_ORDER: 'gemini,claude' }).join()).toMatch(/AI_PROVIDER_ORDER/);
  });

  it('requires a model when a provider key is set, and lists configured providers in order', () => {
    expect(problemsOf({ OPENAI_API_KEY: 'sk-test' }).join()).toMatch(/OPENAI_MODEL is required/);
    const env = makeEnv({
      AI_PROVIDER_ORDER: 'mistral,openai,gemini',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'some-model',
      MISTRAL_API_KEY: 'm-test',
      MISTRAL_MODEL: 'some-model',
    });
    expect(configuredProviders(env)).toEqual(['mistral', 'openai']);
  });

  it('parses TRUST_PROXY as false or a hop count', () => {
    expect(makeEnv({ TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
    expect(makeEnv({ TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(problemsOf({ TRUST_PROXY: 'true' }).join()).toMatch(/TRUST_PROXY/);
    expect(problemsOf({ TRUST_PROXY: 'loopback' }).join()).toMatch(/TRUST_PROXY/);
  });
});

describe('env: secrets and origins', () => {
  it('requires secrets of at least 32 characters', () => {
    expect(problemsOf({ JWT_ACCESS_SECRET: 'short' }).join()).toMatch(
      /JWT_ACCESS_SECRET must be at least 32/,
    );
    expect(problemsOf({ INGEST_API_KEY: undefined }).join()).toMatch(/INGEST_API_KEY/);
    expect(problemsOf({ SEED_ADMIN_PASSWORD: 'short-pass' }).join()).toMatch(/SEED_ADMIN_PASSWORD/);
  });

  it('accepts exact origins only and never "*"', () => {
    expect(
      makeEnv({ CORS_ALLOWED_ORIGINS: 'http://localhost:3000,https://app.example.com' }).CORS_ALLOWED_ORIGINS,
    ).toEqual(['http://localhost:3000', 'https://app.example.com']);
    expect(problemsOf({ CORS_ALLOWED_ORIGINS: '*' }).join()).toMatch(/not allowed/);
    expect(problemsOf({ CORS_ALLOWED_ORIGINS: 'http://localhost:3000/' }).join()).toMatch(/not an origin/);
    expect(problemsOf({ CORS_ALLOWED_ORIGINS: 'https://app.example.com/path' }).join()).toMatch(
      /not an origin/,
    );
  });

  it('requires COOKIE_SECURE=true for COOKIE_SAME_SITE=none', () => {
    expect(problemsOf({ COOKIE_SAME_SITE: 'none', COOKIE_SECURE: 'false' }).join()).toMatch(
      /COOKIE_SAME_SITE=none/,
    );
  });

  it('reports every problem at once', () => {
    const problems = problemsOf({ JWT_ACCESS_SECRET: 'x', DEMO_MODE: 'maybe', MAX_BATCH_SIZE: '-1' });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe('env: production guards', () => {
  const production = {
    APP_ENV: 'production',
    DEMO_MODE: 'false',
    COOKIE_SECURE: 'true',
    CORS_ALLOWED_ORIGINS: 'https://monitor.example.com',
    DATABASE_URL: 'postgres://apimon:Prod-db-Pass-91@db:5432/apimon',
    REDIS_URL: 'redis://:Prod-redis-Pass-91@redis:6379/0',
    JWT_ACCESS_SECRET: 'q'.repeat(48),
    INGEST_API_KEY: 'k'.repeat(48),
    INTERNAL_SERVICE_KEY: 'i'.repeat(48),
    SEED_ADMIN_PASSWORD: 'Prod-Admin-Password-2026',
  };

  it('accepts a correct production configuration', () => {
    expect(problemsOf(production)).toEqual([]);
  });

  it('refuses DEMO_MODE=true', () => {
    expect(problemsOf({ ...production, DEMO_MODE: 'true' }).join()).toMatch(/DEMO_MODE=true is forbidden/);
  });

  it('refuses dev-only- secrets', () => {
    const problems = problemsOf({
      ...production,
      JWT_ACCESS_SECRET: 'dev-only-jwt-secret-replace-with-openssl-rand-base64-48',
      INGEST_API_KEY: 'dev-only-ingest-key-0123456789abcdef0123456789abcdef',
      DATABASE_URL: 'postgres://apimon:dev-only-postgres-password@db:5432/apimon',
    }).join('\n');
    expect(problems).toMatch(/JWT_ACCESS_SECRET still uses a dev-only- value/);
    expect(problems).toMatch(/INGEST_API_KEY still uses a dev-only- value/);
    expect(problems).toMatch(/DATABASE_URL still uses a dev-only- value/);
  });

  it('refuses the shipped .env.example values outright', () => {
    const problems = problemsOf({
      ...BASE_ENV,
      APP_ENV: 'production',
      DEMO_MODE: 'true',
      SEED_ADMIN_PASSWORD: 'dev-only-Admin-2026',
    });
    expect(problems.join()).toMatch(/DEMO_MODE/);
    expect(problems.join()).toMatch(/SEED_ADMIN_PASSWORD still uses a dev-only- value/);
    expect(problems.join()).toMatch(/COOKIE_SECURE must be true/);
  });

  it('refuses COOKIE_SECURE=false and plain-http non-localhost origins', () => {
    expect(problemsOf({ ...production, COOKIE_SECURE: 'false' }).join()).toMatch(
      /COOKIE_SECURE must be true/,
    );
    expect(problemsOf({ ...production, CORS_ALLOWED_ORIGINS: 'http://monitor.example.com' }).join()).toMatch(
      /must use https/,
    );
    expect(problemsOf({ ...production, CORS_ALLOWED_ORIGINS: 'http://localhost:3000' })).toEqual([]);
  });
});
