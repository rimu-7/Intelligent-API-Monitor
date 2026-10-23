import { LLM_PROVIDER_NAMES, type LlmProviderName } from '@apimon/shared';
import type { Redis } from 'ioredis';
import { configuredProviders, type Env } from '../../config/env';
import type { DatabaseHandle } from '../../infrastructure/database/client';
import { pingRedis } from '../../infrastructure/redis/connections';
import { ServiceUnavailableError } from '../../lib/errors';
import { APP_VERSION } from '../../lib/version';

export const CIRCUIT_HASH_KEY = 'ai:circuit';

type CheckResult = { status: 'up'; latency_ms: number } | { status: 'down'; error: string };

const timed = async (fn: () => Promise<unknown>): Promise<CheckResult> => {
  const started = performance.now();
  try {
    await fn();
    return { status: 'up', latency_ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { status: 'down', error: error instanceof Error ? error.message : 'unavailable' };
  }
};

export interface HealthDeps {
  env: Env;
  database: DatabaseHandle;
  redis: Redis;
  isShuttingDown: () => boolean;
  fetchFn?: typeof fetch;
}

export class HealthService {
  private readonly startedAt = Date.now();

  constructor(private readonly deps: HealthDeps) {}

  /** Readiness: DB and Redis reachable and not shutting down (503 otherwise). */
  async ready(): Promise<{ status: 'ready' }> {
    if (this.deps.isShuttingDown()) throw new ServiceUnavailableError('Shutting down');
    const [db, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    if (db.status !== 'up' || redis.status !== 'up')
      throw new ServiceUnavailableError('Dependencies unavailable');
    return { status: 'ready' };
  }

  async report() {
    const [database, redis, simulator, circuits] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkSimulator(),
      this.readCircuits(),
    ]);
    const configured = new Set<LlmProviderName>(configuredProviders(this.deps.env));
    const order = [
      ...this.deps.env.AI_PROVIDER_ORDER,
      ...LLM_PROVIDER_NAMES.filter((name) => !this.deps.env.AI_PROVIDER_ORDER.includes(name)),
    ];
    return {
      status: database.status === 'up' && redis.status === 'up' ? 'ok' : 'degraded',
      version: APP_VERSION,
      uptime_s: Math.round((Date.now() - this.startedAt) / 1000),
      checks: { database, redis, simulator },
      ai_providers: order.map((name) => ({
        name,
        configured: configured.has(name),
        circuit: circuits[name] ?? { state: 'CLOSED', since: null },
      })),
    };
  }

  private checkDatabase() {
    return timed(() => this.deps.database.ping());
  }

  private checkRedis() {
    return timed(() => pingRedis(this.deps.redis));
  }

  /** Informational only — never affects readiness. */
  private checkSimulator() {
    const fetchFn = this.deps.fetchFn ?? fetch;
    return timed(async () => {
      const response = await fetchFn(`${this.deps.env.SIMULATOR_URL}/health`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    });
  }

  private async readCircuits(): Promise<Record<string, { state: string; since: string | null }>> {
    try {
      const raw = await this.deps.redis.hgetall(CIRCUIT_HASH_KEY);
      return Object.fromEntries(
        Object.entries(raw).map(([name, value]) => {
          try {
            const parsed = JSON.parse(value) as { state?: unknown; since?: unknown };
            return [
              name,
              {
                state: typeof parsed.state === 'string' ? parsed.state : 'UNKNOWN',
                since: typeof parsed.since === 'string' ? parsed.since : null,
              },
            ];
          } catch {
            return [name, { state: 'UNKNOWN', since: null }];
          }
        }),
      );
    } catch {
      return {};
    }
  }
}
