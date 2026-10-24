import type { Logger } from '../logger';
import { isRetryableTransactionError, withRetry } from '../../lib/retry';
import type { Database } from './client';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Runs `fn` in a transaction, retrying up to 3 times with jitter on deadlock (40P01)
 * or serialization failure (40001) (§8.1 step 6, §21.6).
 */
export const runInTransaction = <T>(
  db: Database,
  logger: Logger,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> =>
  withRetry(() => db.transaction(fn), {
    attempts: 3,
    baseDelayMs: 25,
    shouldRetry: isRetryableTransactionError,
    onRetry: (err, attempt) => logger.warn({ err, attempt }, 'transaction conflict, retrying'),
  });
