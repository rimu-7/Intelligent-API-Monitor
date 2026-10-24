import { REALTIME_CHANNEL } from '@apimon/shared';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/infrastructure/logger';
import { SUMMARY_CACHE_KEY } from '../../src/modules/alerts/alerts.cache';
import { EventBus } from '../../src/modules/realtime/event-bus';

const setup = () => {
  const calls: string[] = [];
  const redis = {
    del: vi.fn((key: string) => {
      calls.push(`del:${key}`);
      return Promise.resolve(1);
    }),
    publish: vi.fn((channel: string) => {
      calls.push(`publish:${channel}`);
      return Promise.resolve(1);
    }),
  };
  const logger = { warn: vi.fn() };
  const bus = new EventBus(redis as unknown as Redis, logger as unknown as Logger);
  return { bus, redis, logger, calls };
};

describe('EventBus', () => {
  it('drops the cached alert summary before publishing an alert change', async () => {
    const { bus, calls } = setup();
    await bus.publish('alerts.invalidated', { reason: 'bulk_ingest', count: 60 });
    expect(calls).toEqual([`del:${SUMMARY_CACHE_KEY}`, `publish:${REALTIME_CHANNEL}`]);
  });

  it('keeps the summary cache for events that do not change alerts', async () => {
    const { bus, redis } = setup();
    await bus.publish('monitor.run.completed', { run: undefined as never });
    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.publish).toHaveBeenCalledOnce();
  });

  it('still publishes when the cache delete fails', async () => {
    const { bus, redis, logger } = setup();
    redis.del.mockRejectedValueOnce(new Error('redis down'));
    await bus.publish('alerts.invalidated', { reason: 'auto_resolve', count: 51 });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(redis.publish).toHaveBeenCalledOnce();
  });
});
