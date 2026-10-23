import { z } from 'zod';
import type { Logger } from '../../infrastructure/logger';
import { AppError, ServiceUnavailableError } from '../../lib/errors';

const TIMEOUT_MS = 10_000;

const envelope = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.unknown().optional(),
});

/**
 * API → simulator control client (§14). The simulator URL comes from env only (no SSRF);
 * requests carry `x-internal-key`. Network failures become 502 SIMULATOR_UNAVAILABLE.
 */
export class SimulatorClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalKey: string,
    private readonly logger: Logger,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'x-internal-key': this.internalKey,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn({ err, path }, 'simulator unreachable');
      throw new ServiceUnavailableError('The telemetry simulator is unavailable', 'SIMULATOR_UNAVAILABLE');
    }

    const parsed = envelope.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new ServiceUnavailableError(
        'The telemetry simulator returned an invalid response',
        'SIMULATOR_UNAVAILABLE',
      );
    }
    if (!response.ok || !parsed.data.success) {
      const error = z.object({ code: z.string(), message: z.string() }).safeParse(parsed.data.error);
      if (response.status === 404) {
        throw new AppError('NOT_FOUND', error.success ? error.data.message : 'Not found');
      }
      if (response.status === 400) {
        throw new AppError(
          'VALIDATION_ERROR',
          error.success ? error.data.message : 'Invalid simulator request',
        );
      }
      this.logger.warn({ status: response.status, path }, 'simulator request failed');
      throw new ServiceUnavailableError(
        'The telemetry simulator rejected the request',
        'SIMULATOR_UNAVAILABLE',
      );
    }
    return parsed.data.data;
  }

  fetchTelemetry(count: number): Promise<unknown> {
    return this.call('GET', `/api/telemetry?count=${count}`);
  }

  listScenarios(): Promise<unknown> {
    return this.call('GET', '/api/scenarios');
  }

  runScenario(name: string): Promise<unknown> {
    return this.call('POST', `/api/scenarios/${encodeURIComponent(name)}`);
  }

  startStream(options: { interval_ms: number; batch_size: number }): Promise<unknown> {
    return this.call('POST', '/api/stream/start', options);
  }

  stopStream(): Promise<unknown> {
    return this.call('POST', '/api/stream/stop');
  }

  streamStatus(): Promise<unknown> {
    return this.call('GET', '/api/stream/status');
  }
}
