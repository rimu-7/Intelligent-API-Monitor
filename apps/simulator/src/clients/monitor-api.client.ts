import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { TelemetryItem } from '../generator/telemetry-generator';
import type { Logger } from '../logger';

export interface PushResult {
  status: number;
  run_id: string | null;
  received: number;
  anomalous: number;
  alerts_created: number;
  alerts_updated: number;
  idempotency_key: string;
  attempts: number;
}

export class PushError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'PushError';
  }
}

const RETRYABLE = new Set([409, 429, 500, 502, 503, 504]);

/**
 * Pushes batches to `${MONITOR_API_URL}/api/v1/monitor` with the ingest key (§14). Every batch gets
 * a fresh Idempotency-Key and every retry reuses it, so a retry can never double-count.
 */
export class MonitorApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly ingestKey: string,
    private readonly logger: Logger,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly retryDelaysMs: readonly number[] = [500, 1_000, 2_000],
  ) {}

  async push(items: TelemetryItem[], label: string): Promise<PushResult> {
    const idempotencyKey = randomUUID();
    const body = JSON.stringify({ logs: items, source: `simulator:${label}`.slice(0, 50) });
    let lastError: PushError | undefined;

    for (let attempt = 1; attempt <= this.retryDelaysMs.length + 1; attempt += 1) {
      try {
        const response = await this.fetchFn(`${this.baseUrl}/api/v1/monitor`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-ingest-key': this.ingestKey,
            'idempotency-key': idempotencyKey,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        const payload = (await response.json().catch(() => null)) as {
          data?: Record<string, unknown>;
        } | null;
        if (response.ok) {
          const data = payload?.data ?? {};
          return {
            status: response.status,
            run_id: typeof data.run_id === 'string' ? data.run_id : null,
            received: Number(data.received ?? items.length),
            anomalous: Number(data.anomalous ?? 0),
            alerts_created: Number(data.alerts_created ?? 0),
            alerts_updated: Number(data.alerts_updated ?? 0),
            idempotency_key: idempotencyKey,
            attempts: attempt,
          };
        }
        lastError = new PushError(`monitor API answered ${response.status}`, response.status);
        if (!RETRYABLE.has(response.status)) throw lastError;
      } catch (error) {
        if (error instanceof PushError && error.status !== null && !RETRYABLE.has(error.status)) throw error;
        lastError =
          error instanceof PushError
            ? error
            : new PushError(error instanceof Error ? error.message : 'network error', null);
      }
      const delay = this.retryDelaysMs[attempt - 1];
      if (delay === undefined) break;
      this.logger.warn(
        { attempt, label, status: lastError.status },
        'push failed, retrying with the same Idempotency-Key',
      );
      await sleep(delay);
    }
    throw lastError ?? new PushError('push failed', null);
  }
}
