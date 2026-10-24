import {
  REALTIME_CHANNEL,
  type RealtimeEvent,
  type RealtimeEventName,
  type RealtimeEventPayloads,
} from '@apimon/shared';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../../infrastructure/logger';
import { SUMMARY_CACHE_KEY } from '../alerts/alerts.cache';

/** Events that change alert counts, so the cached summary must be dropped first. */
const ALERT_CHANGE_EVENTS: ReadonlySet<RealtimeEventName> = new Set<RealtimeEventName>([
  'alert.created',
  'alert.updated',
  'alert.resolved',
  'alerts.invalidated',
]);

/**
 * Publishes realtime events to Redis channel `apimon:events` (§13.1). Both API and worker
 * publish; only API processes subscribe and fan out to SSE clients. Publishing never throws:
 * events are notifications, the database is the source of truth.
 */
export class EventBus {
  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  async publish<N extends RealtimeEventName>(name: N, data: RealtimeEventPayloads[N]): Promise<void> {
    const event: RealtimeEvent<N> = { id: randomUUID(), name, data };
    if (ALERT_CHANGE_EVENTS.has(name)) {
      // Otherwise clients refetching on this event would read stale counts for up to 5 s.
      await this.redis.del(SUMMARY_CACHE_KEY).catch((err: unknown) => {
        this.logger.warn({ err }, 'summary cache invalidation failed');
      });
    }
    try {
      await this.redis.publish(REALTIME_CHANNEL, JSON.stringify(event));
    } catch (err) {
      this.logger.warn({ err, event: name }, 'realtime publish failed');
    }
  }
}
