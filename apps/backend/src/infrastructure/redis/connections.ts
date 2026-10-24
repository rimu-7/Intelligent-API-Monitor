import { Redis, type RedisOptions } from 'ioredis';
import { withTimeout } from '../../lib/timeout';
import type { Logger } from '../logger';

/**
 * Redis connection factories (§21.8, §21.9):
 * - `command`    — normal commands (cache, rate limits, idempotency, tickets). Fails fast when Redis is down.
 * - `subscriber` — dedicated pub/sub connection (subscriber mode blocks other commands).
 * - BullMQ gets connection *options* and owns its own connections (`bullmqConnection`).
 */

export type RedisRole = 'command' | 'subscriber';

const retryStrategy = (times: number) => Math.min(times * 200, 2_000);

const roleOptions: Record<RedisRole, RedisOptions> = {
  command: { maxRetriesPerRequest: 2, enableOfflineQueue: true },
  subscriber: { maxRetriesPerRequest: null, enableOfflineQueue: true },
};

export const createRedis = (url: string, role: RedisRole, logger: Logger, name = role): Redis => {
  const client = new Redis(url, {
    connectionName: `apimon:${name}`,
    connectTimeout: 5_000,
    retryStrategy,
    lazyConnect: false,
    ...roleOptions[role],
  });

  // Log state transitions once instead of every retry.
  let lastState = '';
  const report = (state: string, level: 'info' | 'warn', err?: unknown) => {
    if (state === lastState) return;
    lastState = state;
    logger[level]({ redis: name, ...(err ? { err } : {}) }, `redis ${state}`);
  };
  client.on('ready', () => report('ready', 'info'));
  client.on('error', (err) => report('error', 'warn', err));
  client.on('end', () => report('closed', 'warn'));

  return client;
};

/** Options for BullMQ Queue/Worker/QueueEvents. Blocking connections need maxRetriesPerRequest: null. */
export const bullmqConnection = (url: string) => ({
  url,
  maxRetriesPerRequest: null,
  connectTimeout: 5_000,
  retryStrategy,
});

export const pingRedis = async (client: Redis, timeoutMs = 2_000): Promise<void> => {
  await withTimeout(client.ping(), timeoutMs, 'redis ping');
};

export const closeRedis = async (client: Redis): Promise<void> => {
  if (client.status === 'end') return;
  try {
    await withTimeout(client.quit(), 2_000, 'redis quit');
  } catch {
    client.disconnect();
  }
};
