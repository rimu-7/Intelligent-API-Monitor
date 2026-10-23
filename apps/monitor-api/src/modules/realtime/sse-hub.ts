import { REALTIME_CHANNEL, type RealtimeEvent } from '@apimon/shared';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../../infrastructure/logger';
import { RateLimitedError } from '../../lib/errors';

export interface SseLimits {
  perKey: number;
  total: number;
  heartbeatMs: number;
}

const DEFAULT_LIMITS: SseLimits = { perKey: 5, total: 500, heartbeatMs: 20_000 };

interface Client {
  id: string;
  key: string;
  res: Response;
}

const frame = (name: string, data: unknown, id: string = randomUUID()) =>
  `id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Server-sent events fan-out (§13.1). Every API instance subscribes to `apimon:events` on a
 * dedicated connection (subscriber mode blocks other commands) and writes to its own clients,
 * so the API stays stateless and horizontally scalable.
 */
export class SseHub {
  private readonly clients = new Map<string, Client>();
  private heartbeat: NodeJS.Timeout | undefined;
  private started = false;
  private closing = false;

  constructor(
    private readonly subscriber: Redis,
    private readonly logger: Logger,
    private readonly limits: SseLimits = DEFAULT_LIMITS,
  ) {}

  get size(): number {
    return this.clients.size;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.subscriber.on('message', (channel: string, message: string) => {
      if (channel === REALTIME_CHANNEL) this.broadcastRaw(message);
    });
    await this.subscriber.subscribe(REALTIME_CHANNEL);
    this.heartbeat = setInterval(() => this.writeAll(': ping\n\n'), this.limits.heartbeatMs);
    this.heartbeat.unref();
  }

  /** Opens a stream for `key` (user id or anonymous IP). 429 when a limit is reached. */
  connect(res: Response, key: string): void {
    if (this.closing) throw new RateLimitedError(5, 'Server is shutting down');
    const forKey = [...this.clients.values()].filter((client) => client.key === key).length;
    if (forKey >= this.limits.perKey || this.clients.size >= this.limits.total) {
      throw new RateLimitedError(30, 'Too many open streams');
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 5000\n\n');

    const client: Client = { id: randomUUID(), key, res };
    this.clients.set(client.id, client);
    res.write(frame('ready', { client_id: client.id }));
    res.on('close', () => this.clients.delete(client.id));
  }

  private broadcastRaw(message: string): void {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(message) as RealtimeEvent;
    } catch {
      this.logger.warn('dropping malformed realtime event');
      return;
    }
    this.writeAll(frame(event.name, event.data, event.id));
  }

  private writeAll(chunk: string): void {
    for (const client of this.clients.values()) {
      if (!client.res.writableEnded) client.res.write(chunk);
    }
  }

  /** Sends `event: shutdown`, ends every stream and stops listening (§16.4). */
  async shutdown(): Promise<void> {
    this.closing = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const client of this.clients.values()) {
      if (!client.res.writableEnded) client.res.end(frame('shutdown', { reconnect_after_ms: 5000 }));
    }
    this.clients.clear();
    if (this.started) await this.subscriber.unsubscribe(REALTIME_CHANNEL).catch(() => undefined);
  }
}
