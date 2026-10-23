import {
  REALTIME_CHANNEL,
  type RealtimeEvent,
  type RealtimeEventName,
  type RealtimeEventPayloads,
} from '@apimon/shared';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../../infrastructure/logger';

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
    try {
      await this.redis.publish(REALTIME_CHANNEL, JSON.stringify(event));
    } catch (err) {
      this.logger.warn({ err, event: name }, 'realtime publish failed');
    }
  }
}
