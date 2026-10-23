import type { MonitoredApiDto } from '@apimon/shared';
import type { Redis } from 'ioredis';
import type { Logger } from '../../infrastructure/logger';
import type { UserPrincipal } from '../../http/principal';
import type { AuditContext, AuditService } from '../audit/audit.service';
import type { ThresholdsService } from '../monitoring/thresholds.service';
import type { ApisRepository } from './apis.repository';
import type { UpdateThresholdsInput } from './apis.schemas';

export const APIS_CACHE_KEY = 'cache:apis:list';
const APIS_TTL_SECONDS = 10;

export interface ThresholdsDto {
  name: string;
  latency_warning_ms: number;
  latency_critical_ms: number;
  expects_records: boolean;
  uses_default_thresholds: boolean;
}

export class ApisService {
  constructor(
    private readonly deps: {
      repository: ApisRepository;
      thresholds: ThresholdsService;
      redis: Redis;
      audit: AuditService;
      logger: Logger;
    },
  ) {}

  /** Monitored APIs with last-hour stats, cached for 10 s. */
  async list(): Promise<MonitoredApiDto[]> {
    const { redis, repository, thresholds, logger } = this.deps;
    try {
      const cached = await redis.get(APIS_CACHE_KEY);
      if (cached) return JSON.parse(cached) as MonitoredApiDto[];
    } catch (err) {
      logger.warn({ err }, 'apis cache read failed');
    }
    const rows = await repository.listWithStats();
    const apis = rows.map((row): MonitoredApiDto => {
      const effective = thresholds.merge(row);
      return {
        name: row.name,
        latency_warning_ms: effective.latencyWarningMs,
        latency_critical_ms: effective.latencyCriticalMs,
        expects_records: row.expectsRecords,
        uses_default_thresholds: row.latencyWarningMs === null,
        first_seen_at: row.firstSeenAt.toISOString(),
        last_seen_at: row.lastSeenAt.toISOString(),
        last_hour: {
          requests: row.requests,
          error_rate: row.requests === 0 ? 0 : Math.round((row.errors / row.requests) * 10_000) / 10_000,
          p95_latency_ms: row.p95LatencyMs,
        },
        active_alerts: row.activeAlerts,
      };
    });
    redis.set(APIS_CACHE_KEY, JSON.stringify(apis), 'EX', APIS_TTL_SECONDS).catch((err: unknown) => {
      logger.warn({ err }, 'apis cache write failed');
    });
    return apis;
  }

  async updateThresholds(
    name: string,
    input: UpdateThresholdsInput,
    actor: UserPrincipal,
    context: AuditContext,
  ): Promise<ThresholdsDto> {
    const { repository, thresholds, redis, audit } = this.deps;
    const before = await repository.findByName(name);
    const row = await repository.upsertThresholds(name, {
      latencyWarningMs: input.latency_warning_ms,
      latencyCriticalMs: input.latency_critical_ms,
      ...(input.expects_records === undefined ? {} : { expectsRecords: input.expects_records }),
    });
    await thresholds.invalidate(name);
    await redis.del(APIS_CACHE_KEY).catch(() => undefined);
    await audit.record({
      action: 'api.thresholds_changed',
      actor,
      target: { type: 'api', id: name },
      metadata: {
        from: before
          ? {
              latency_warning_ms: before.latencyWarningMs,
              latency_critical_ms: before.latencyCriticalMs,
              expects_records: before.expectsRecords,
            }
          : null,
        to: input,
      },
      context,
    });
    const effective = thresholds.merge(row);
    return {
      name: row.name,
      latency_warning_ms: effective.latencyWarningMs,
      latency_critical_ms: effective.latencyCriticalMs,
      expects_records: row.expectsRecords,
      uses_default_thresholds: row.latencyWarningMs === null,
    };
  }
}
