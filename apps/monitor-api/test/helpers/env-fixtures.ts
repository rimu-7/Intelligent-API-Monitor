import { parseEnv, type Env, type EnvInput } from '../../src/config/env';

/** A complete, valid environment for tests. Secrets are long enough and clearly fake. */
export const BASE_ENV: EnvInput = {
  APP_ENV: 'test',
  LOG_LEVEL: 'silent',
  DEMO_MODE: 'false',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
  DATABASE_URL: 'postgres://apimon:dev-only-postgres-password@localhost:5432/apimon_test',
  REDIS_URL: 'redis://:dev-only-redis-password@localhost:6379/1',
  JWT_ACCESS_SECRET: 'test-jwt-secret-0123456789abcdef0123456789abcdef',
  INGEST_API_KEY: 'test-ingest-key-0123456789abcdef0123456789abcdef',
  INTERNAL_SERVICE_KEY: 'test-internal-key-0123456789abcdef0123456789ab',
  SEED_ADMIN_EMAIL: 'admin@example.com',
  SEED_ADMIN_PASSWORD: 'test-Admin-password-2026',
  AI_SYNC_WAIT_MS: '0',
  SIMULATOR_URL: 'http://127.0.0.1:59999',
  // Email on, against a test double mailer (tests inject FakeMailer).
  EMAIL_ENABLED: 'true',
  SMTP_HOST: 'localhost',
};

export const makeEnv = (overrides: EnvInput = {}): Env => parseEnv({ ...BASE_ENV, ...overrides });
