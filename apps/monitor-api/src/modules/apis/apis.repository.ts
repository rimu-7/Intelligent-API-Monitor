import { eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../infrastructure/database/client';
import { monitoredApis, type MonitoredApiRow } from '../../infrastructure/database/schema';
import type { StoredThresholds, ThresholdsSource } from '../monitoring/thresholds.service';

export interface ApiStatsRow {
  name: string;
  latencyWarningMs: number | null;
  latencyCriticalMs: number | null;
  expectsRecords: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  requests: number;
  errors: number;
  p95LatencyMs: number | null;
  activeAlerts: number;
}

export class ApisRepository implements ThresholdsSource {
  constructor(private readonly db: DbExecutor) {}

  async findThresholds(names: readonly string[]): Promise<StoredThresholds[]> {
    if (names.length === 0) return [];
    return this.db
      .select({
        name: monitoredApis.name,
        latencyWarningMs: monitoredApis.latencyWarningMs,
        latencyCriticalMs: monitoredApis.latencyCriticalMs,
        expectsRecords: monitoredApis.expectsRecords,
      })
      .from(monitoredApis)
      .where(inArray(monitoredApis.name, [...names]));
  }

  async findByName(name: string): Promise<MonitoredApiRow | undefined> {
    const [row] = await this.db.select().from(monitoredApis).where(eq(monitoredApis.name, name)).limit(1);
    return row;
  }

  /** Every monitored API with last-hour request count, failed requests (status ≥ 400), p95 latency and active alerts. */
  async listWithStats(): Promise<ApiStatsRow[]> {
    const result = await this.db.execute<{
      name: string;
      latency_warning_ms: number | null;
      latency_critical_ms: number | null;
      expects_records: boolean;
      first_seen_at: Date | string;
      last_seen_at: Date | string;
      requests: string | number;
      errors: string | number;
      p95: string | number | null;
      active_alerts: string | number;
    }>(sql`
      SELECT m.name, m.latency_warning_ms, m.latency_critical_ms, m.expects_records, m.first_seen_at, m.last_seen_at,
             COALESCE(s.requests, 0) AS requests,
             COALESCE(s.errors, 0) AS errors,
             s.p95,
             COALESCE(a.active_alerts, 0) AS active_alerts
      FROM monitored_apis m
      LEFT JOIN (
        SELECT api_name,
               count(*) AS requests,
               count(*) FILTER (WHERE status_code >= 400) AS errors,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)
                 FILTER (WHERE response_time_ms IS NOT NULL) AS p95
        FROM telemetry_logs
        WHERE observed_at >= now() - interval '1 hour'
        GROUP BY api_name
      ) s ON s.api_name = m.name
      LEFT JOIN (
        SELECT api_name, count(*) AS active_alerts FROM alerts WHERE status = 'ACTIVE' GROUP BY api_name
      ) a ON a.api_name = m.name
      ORDER BY m.name
    `);
    return result.rows.map((row) => ({
      name: row.name,
      latencyWarningMs: row.latency_warning_ms,
      latencyCriticalMs: row.latency_critical_ms,
      expectsRecords: row.expects_records,
      firstSeenAt: new Date(row.first_seen_at),
      lastSeenAt: new Date(row.last_seen_at),
      requests: Number(row.requests),
      errors: Number(row.errors),
      p95LatencyMs: row.p95 === null ? null : Math.round(Number(row.p95)),
      activeAlerts: Number(row.active_alerts),
    }));
  }

  /** Creates the API row if needed (thresholds may be configured before the first sample). */
  async upsertThresholds(
    name: string,
    values: { latencyWarningMs: number | null; latencyCriticalMs: number | null; expectsRecords?: boolean },
    executor: DbExecutor = this.db,
  ): Promise<MonitoredApiRow> {
    const [row] = await executor
      .insert(monitoredApis)
      .values({ name, ...values })
      .onConflictDoUpdate({
        target: monitoredApis.name,
        set: {
          latencyWarningMs: values.latencyWarningMs,
          latencyCriticalMs: values.latencyCriticalMs,
          ...(values.expectsRecords === undefined ? {} : { expectsRecords: values.expectsRecords }),
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('threshold upsert returned no row');
    return row;
  }
}
