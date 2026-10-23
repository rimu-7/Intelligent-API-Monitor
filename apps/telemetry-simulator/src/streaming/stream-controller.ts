import type { TelemetryGenerator } from '../generator/telemetry-generator';
import type { Logger } from '../logger';
import type { MonitorApiClient } from '../clients/monitor-api.client';

export interface StreamOptions {
  intervalMs: number;
  batchSize: number;
}

export interface StreamStatus {
  streaming: boolean;
  interval_ms: number | null;
  batch_size: number | null;
  started_at: string | null;
  stops_at: string | null;
  batches_sent: number;
  items_sent: number;
  consecutive_failures: number;
  last_error: string | null;
  stopped_reason: string | null;
}

const MAX_BACKOFF_MS = 30_000;

/**
 * Continuous telemetry stream (§14): a setTimeout chain (never setInterval), single-flight
 * (a tick never overlaps a push in flight), ±20 % jitter, exponential backoff up to 30 s on
 * failure, and an automatic stop after STREAM_MAX_DURATION_MS to protect the LLM budget.
 */
export class StreamController {
  private timer: NodeJS.Timeout | undefined;
  private options: StreamOptions | undefined;
  private startedAt: number | undefined;
  private inFlight = false;
  private status: Omit<StreamStatus, 'streaming' | 'interval_ms' | 'batch_size' | 'started_at' | 'stops_at'> =
    {
      batches_sent: 0,
      items_sent: 0,
      consecutive_failures: 0,
      last_error: null,
      stopped_reason: null,
    };

  constructor(
    private readonly generator: TelemetryGenerator,
    private readonly client: Pick<MonitorApiClient, 'push'>,
    private readonly maxDurationMs: number,
    private readonly logger: Logger,
    private readonly random: () => number = Math.random,
    private readonly now: () => number = Date.now,
  ) {}

  get streaming(): boolean {
    return this.options !== undefined;
  }

  start(options: StreamOptions): StreamStatus {
    this.stop('restarted');
    this.options = options;
    this.startedAt = this.now();
    this.status = {
      batches_sent: 0,
      items_sent: 0,
      consecutive_failures: 0,
      last_error: null,
      stopped_reason: null,
    };
    this.logger.info({ ...options, max_duration_ms: this.maxDurationMs }, 'stream started');
    this.schedule(0);
    return this.getStatus();
  }

  stop(reason = 'stopped'): StreamStatus {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.options) {
      this.logger.info({ reason, ...this.status }, 'stream stopped');
      this.status.stopped_reason = reason;
    }
    this.options = undefined;
    return this.getStatus();
  }

  getStatus(): StreamStatus {
    return {
      streaming: this.streaming,
      interval_ms: this.options?.intervalMs ?? null,
      batch_size: this.options?.batchSize ?? null,
      started_at: this.startedAt && this.options ? new Date(this.startedAt).toISOString() : null,
      stops_at:
        this.startedAt && this.options ? new Date(this.startedAt + this.maxDurationMs).toISOString() : null,
      ...this.status,
    };
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref();
  }

  private nextDelay(): number {
    const options = this.options;
    if (!options) return 0;
    const failures = this.status.consecutive_failures;
    const base =
      failures > 0 ? Math.min(options.intervalMs * 2 ** failures, MAX_BACKOFF_MS) : options.intervalMs;
    return Math.round(base * (0.8 + this.random() * 0.4));
  }

  private async tick(): Promise<void> {
    const options = this.options;
    if (!options || this.startedAt === undefined) return;
    if (this.now() - this.startedAt >= this.maxDurationMs) {
      this.stop('max_duration_reached');
      return;
    }
    if (this.inFlight) {
      this.schedule(this.nextDelay());
      return;
    }
    this.inFlight = true;
    try {
      const items = this.generator.batch(options.batchSize);
      await this.client.push(items, 'stream');
      this.status.batches_sent += 1;
      this.status.items_sent += items.length;
      this.status.consecutive_failures = 0;
      this.status.last_error = null;
    } catch (error) {
      this.status.consecutive_failures += 1;
      this.status.last_error = error instanceof Error ? error.message : 'push failed';
      this.logger.warn(
        { failures: this.status.consecutive_failures, err: error },
        'stream push failed, backing off',
      );
    } finally {
      this.inFlight = false;
    }
    // stop() may have run while the push was in flight.
    if (this.options === options) this.schedule(this.nextDelay());
  }
}
