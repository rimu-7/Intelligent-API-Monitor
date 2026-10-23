import pg from 'pg';
import { loadEnv } from './config/env';
import { migrateWithLock, resolveMigrationsFolder } from './infrastructure/database/migrator';
import { seedAdmin } from './infrastructure/database/seed';
import { createLogger } from './infrastructure/logger';
import { PasswordService } from './modules/auth/password.service';

/** One-shot: migrations + idempotent seed, then exit 0 (compose `migrate` service). */
const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL, appEnv: env.APP_ENV, service: 'migrate' });
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });

let exitCode = 0;
try {
  logger.info({ migrationsFolder: resolveMigrationsFolder() }, 'applying migrations');
  await migrateWithLock(pool, async (db) => {
    logger.info('migrations applied');
    await seedAdmin(db, new PasswordService(), logger, {
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
    });
  });
} catch (err) {
  logger.fatal({ err }, 'migration failed');
  exitCode = 1;
} finally {
  await pool.end();
}
process.exit(exitCode);
