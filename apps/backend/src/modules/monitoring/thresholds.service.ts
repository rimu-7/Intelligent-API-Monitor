import type { Redis } from 'ioredis';
import type { Logger } from '../../infrastructure/logger';
import type { Thresholds } from './anomaly-engine/types';

export interface StoredThresholds {
  name: string;
  latencyWarningMs: number | null;
  latencyCriticalMs: number | null;
  expectsRecords: boolean;
}

/** Read side of monitored_apis (implemented by ApisRepository; SQL stays in repositories). */
export interface ThresholdsSource {
  findThresholds(names: readonly string[]): Promise<StoredThresholds[]>;
}

const CACHE_TTL_SECONDS = 60;
export const thresholdsCacheKey = (name: string) => `thresholds:${name}`;

const isThresholds = (value: unknown): value is Thresholds =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Thresholds).latencyWarningMs === 'number' &&
  typeof (value as Thresholds).latencyCriticalMs === 'number' &&
  typeof (value as Thresholds).expectsRecords === 'boolean';

/**
 * Per-API thresholds (§7.5): Redis MGET `thresholds:<name>` (60 s) → monitored_apis for
 * misses → merged over the env defaults. Redis failures fall back to the database.
 */
export class ThresholdsService {
  constructor(
    private readonly source: ThresholdsSource,
    private readonly redis: Redis,
    private readonly defaults: { latencyWarningMs: number; latencyCriticalMs: number },
    private readonly logger: Logger,
  ) {}

  /** Custom thresholds apply only when both are set (the DB CHECK guarantees they come in pairs). */
  merge(stored: StoredThresholds | undefined): Thresholds {
    const expectsRecords = stored?.expectsRecords ?? true;
    if (stored && stored.latencyWarningMs !== null && stored.latencyCriticalMs !== null) {
      return {
        latencyWarningMs: stored.latencyWarningMs,
        latencyCriticalMs: stored.latencyCriticalMs,
        expectsRecords,
      };
    }
    return { ...this.defaults, expectsRecords };
  }

  async getThresholds(names: readonly string[]): Promise<Map<string, Thresholds>> {
    const unique = [...new Set(names)];
    const result = new Map<string, Thresholds>();
    if (unique.length === 0) return result;

    let misses = unique;
    try {
      const cached = await this.redis.mget(unique.map(thresholdsCacheKey));
      misses = [];
      unique.forEach((name, i) => {
        const raw = cached[i];
        const parsed: unknown = raw ? JSON.parse(raw) : undefined;
        if (isThresholds(parsed)) result.set(name, parsed);
        else misses.push(name);
      });
    } catch (err) {
      this.logger.warn({ err }, 'threshold cache read failed, using database');
      misses = unique;
    }
    if (misses.length === 0) return result;

    const stored = new Map((await this.source.findThresholds(misses)).map((row) => [row.name, row]));
    const fresh = misses.map((name) => [name, this.merge(stored.get(name))] as const);
    for (const [name, thresholds] of fresh) result.set(name, thresholds);

    try {
      const pipeline = this.redis.pipeline();
      for (const [name, thresholds] of fresh) {
        pipeline.set(thresholdsCacheKey(name), JSON.stringify(thresholds), 'EX', CACHE_TTL_SECONDS);
      }
      await pipeline.exec();
    } catch (err) {
      this.logger.warn({ err }, 'threshold cache write failed');
    }
    return result;
  }

  async invalidate(name: string): Promise<void> {
    try {
      await this.redis.del(thresholdsCacheKey(name));
    } catch (err) {
      this.logger.warn({ err, api: name }, 'threshold cache invalidation failed');
    }
  }
}
