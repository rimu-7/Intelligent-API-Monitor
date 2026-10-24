import path from 'node:path';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { findUp } from '../../lib/paths';
import * as schema from './schema';

/** Arbitrary constant shared by every migrating process: concurrent starts cannot race (§10.1). */
const MIGRATION_LOCK_ID = 7_340_201;

export const resolveMigrationsFolder = (): string => {
  const journal = findUp('drizzle/meta/_journal.json', import.meta.dirname);
  if (!journal) throw new Error('drizzle migrations folder not found');
  return path.dirname(path.dirname(journal));
};

/**
 * Applies pending migrations while holding a Postgres advisory lock, then runs `afterMigrate`
 * (the seed) under the same lock.
 */
export const migrateWithLock = async (
  pool: pg.Pool,
  afterMigrate?: (db: NodePgDatabase<typeof schema>) => Promise<unknown>,
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: resolveMigrationsFolder() });
    await afterMigrate?.(db);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
};
