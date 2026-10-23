import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { withTimeout } from '../../lib/timeout';
import type { Logger } from '../logger';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** A Drizzle transaction handle — same query API as `Database`. */
export type DbExecutor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute' | 'query'>;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  ping(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export const createDatabase = (connectionString: string, logger: Logger, max = 10): DatabaseHandle => {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'apimon',
  });
  // An idle client losing its connection must not crash the process.
  pool.on('error', (err) => logger.error({ err }, 'postgres pool error'));

  const db = drizzle({ client: pool, schema });

  return {
    db,
    pool,
    async ping(timeoutMs = 2_000) {
      await withTimeout(pool.query('SELECT 1'), timeoutMs, 'postgres ping');
    },
    async close() {
      await pool.end();
    },
  };
};
