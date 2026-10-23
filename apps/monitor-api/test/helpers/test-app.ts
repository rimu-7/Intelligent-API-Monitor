import type { Express } from 'express';
import pg from 'pg';
import { pino } from 'pino';
import supertest from 'supertest';
import { createApp } from '../../src/app';
import type { EnvInput } from '../../src/config/env';
import { buildContainer, type Container, type ContainerOptions } from '../../src/container';
import { migrateWithLock } from '../../src/infrastructure/database/migrator';
import type { RouteRegistry } from '../../src/http/secure-router';
import { BASE_ENV, makeEnv } from './env-fixtures';

export interface TestContext {
  container: Container;
  app: Express;
  registry: RouteRegistry;
  http: () => supertest.Agent;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

const TABLES = [
  'alert_notifications',
  'telemetry_logs',
  'rejected_telemetry',
  'alerts',
  'monitor_runs',
  'monitored_apis',
  'audit_logs',
  'refresh_tokens',
  'users',
];

let migrated: Promise<void> | undefined;

const testInfra = (): EnvInput => ({
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? BASE_ENV.DATABASE_URL,
  REDIS_URL: process.env.TEST_REDIS_URL ?? BASE_ENV.REDIS_URL,
});

/** Refuses to run against anything that does not look like a disposable test database. */
const assertDisposable = (databaseUrl: string, redisUrl: string) => {
  const dbName = new URL(databaseUrl).pathname.slice(1);
  const redisDb = new URL(redisUrl).pathname.slice(1) || '0';
  if (!dbName.endsWith('_test'))
    throw new Error(`refusing to run integration tests against database "${dbName}"`);
  if (redisDb === '0') throw new Error('refusing to run integration tests against Redis DB 0');
};

export const createTestContext = async (
  overrides: EnvInput = {},
  containerOptions: Partial<Omit<ContainerOptions, 'env'>> = {},
): Promise<TestContext> => {
  const env = makeEnv({ ...testInfra(), ...overrides });
  assertDisposable(env.DATABASE_URL, env.REDIS_URL);

  migrated ??= (async () => {
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
    try {
      await migrateWithLock(pool);
    } finally {
      await pool.end();
    }
  })();
  await migrated;

  const container = buildContainer({
    env,
    service: 'test',
    logger: pino({ level: 'silent' }),
    ...containerOptions,
  });
  const { app, registry } = createApp(container);

  const reset = async () => {
    await container.db.execute(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    await container.redis.flushdb();
  };
  await reset();

  return {
    container,
    app,
    registry,
    http: () => supertest.agent(app),
    reset,
    close: () => container.close(),
  };
};
