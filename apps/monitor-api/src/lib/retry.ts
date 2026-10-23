import { setTimeout as sleep } from 'node:timers/promises';

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  /** Return true to retry this error. */
  shouldRetry: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

/** Retries with exponential backoff plus full jitter. */
export const withRetry = async <T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= options.attempts || !options.shouldRetry(error)) throw error;
      options.onRetry?.(error, attempt);
      const ceiling = options.baseDelayMs * 2 ** (attempt - 1);
      await sleep(Math.round(ceiling / 2 + Math.random() * (ceiling / 2)));
    }
  }
};

/** Postgres SQLSTATE of an error thrown by `pg` (Drizzle wraps it in `cause`). */
export const pgErrorCode = (error: unknown): string | undefined => {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth += 1) {
    if (typeof current === 'object' && 'code' in current && typeof current.code === 'string') {
      if (/^[0-9A-Z]{5}$/.test(current.code)) return current.code;
    }
    current = typeof current === 'object' && 'cause' in current ? current.cause : undefined;
  }
  return undefined;
};

/** Deadlock or serialization failure — safe to retry the whole transaction. */
export const isRetryableTransactionError = (error: unknown): boolean => {
  const code = pgErrorCode(error);
  return code === '40P01' || code === '40001';
};
