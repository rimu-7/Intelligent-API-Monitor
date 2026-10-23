import type { AnomalyCode, Severity } from '@apimon/shared';
import type { EnrichmentUpdate } from '../ai/alert-enrichment.service';
import { and, arrayContains, count, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../infrastructure/database/client';
import {
  alerts,
  telemetryLogs,
  type AlertRow,
  type TelemetryLogRow,
} from '../../infrastructure/database/schema';

export interface AlertFilters {
  status: 'ACTIVE' | 'RESOLVED' | 'ALL';
  severity?: Severity;
  apiName?: string;
  anomalyType?: AnomalyCode;
  sort: 'last_seen_at' | 'severity';
  limit: number;
  offset: number;
}

export interface AlertCounts {
  activeCritical: number;
  activeWarning: number;
  resolved: number;
  topApis: { apiName: string; activeAlerts: number; critical: number }[];
}

export class AlertsRepository {
  constructor(private readonly db: DbExecutor) {}

  async findById(id: string): Promise<AlertRow | undefined> {
    const [row] = await this.db.select().from(alerts).where(eq(alerts.id, id)).limit(1);
    return row;
  }

  async findByIds(ids: readonly string[]): Promise<AlertRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(alerts)
      .where(inArray(alerts.id, [...ids]));
  }

  async list(filters: AlertFilters): Promise<{ items: AlertRow[]; total: number }> {
    const conditions: SQL[] = [];
    if (filters.status !== 'ALL') conditions.push(eq(alerts.status, filters.status));
    if (filters.severity) conditions.push(eq(alerts.severity, filters.severity));
    if (filters.apiName) conditions.push(eq(alerts.apiName, filters.apiName));
    if (filters.anomalyType) conditions.push(arrayContains(alerts.anomalyTypes, [filters.anomalyType]));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const order =
      filters.sort === 'severity'
        ? [desc(alerts.severity), desc(alerts.lastSeenAt), desc(alerts.id)]
        : [desc(alerts.lastSeenAt), desc(alerts.id)];

    const [items, totals] = await Promise.all([
      this.db
        .select()
        .from(alerts)
        .where(where)
        .orderBy(...order)
        .limit(filters.limit)
        .offset(filters.offset),
      this.db.select({ total: count() }).from(alerts).where(where),
    ]);
    return { items, total: totals[0]?.total ?? 0 };
  }

  /** The last `limit` telemetry samples linked to the alert. */
  recentSamples(alertId: string, limit = 20): Promise<TelemetryLogRow[]> {
    return this.db
      .select()
      .from(telemetryLogs)
      .where(eq(telemetryLogs.alertId, alertId))
      .orderBy(desc(telemetryLogs.observedAt), desc(telemetryLogs.id))
      .limit(limit);
  }

  async counts(topLimit = 5): Promise<AlertCounts> {
    const [statusRows, topRows] = await Promise.all([
      this.db
        .select({ status: alerts.status, severity: alerts.severity, total: count() })
        .from(alerts)
        .groupBy(alerts.status, alerts.severity),
      this.db
        .select({
          apiName: alerts.apiName,
          activeAlerts: count(),
          critical: sql<number>`count(*) FILTER (WHERE ${alerts.severity} = 'CRITICAL')`.mapWith(Number),
        })
        .from(alerts)
        .where(eq(alerts.status, 'ACTIVE'))
        .groupBy(alerts.apiName)
        .orderBy(
          desc(sql`count(*) FILTER (WHERE ${alerts.severity} = 'CRITICAL')`),
          desc(count()),
          alerts.apiName,
        )
        .limit(topLimit),
    ]);
    const pick = (status: string, severity?: string) =>
      statusRows
        .filter((row) => row.status === status && (severity === undefined || row.severity === severity))
        .reduce((sum, row) => sum + row.total, 0);
    return {
      activeCritical: pick('ACTIVE', 'CRITICAL'),
      activeWarning: pick('ACTIVE', 'WARNING'),
      resolved: pick('RESOLVED'),
      topApis: topRows,
    };
  }

  /** Resolves only an ACTIVE alert; returns undefined when it is not active (or missing). */
  async resolve(
    id: string,
    resolution: { resolvedBy: string | null; source: 'MANUAL' | 'AUTO'; note: string | null },
  ): Promise<AlertRow | undefined> {
    const [row] = await this.db
      .update(alerts)
      .set({
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedBy: resolution.resolvedBy,
        resolutionSource: resolution.source,
        resolutionNote: resolution.note,
      })
      .where(and(eq(alerts.id, id), eq(alerts.status, 'ACTIVE')))
      .returning();
    return row;
  }

  /** Reconciler (§13.4): alerts stuck in PENDING for more than `olderThanSeconds`. */
  findStalePending(olderThanSeconds: number, limit = 200) {
    return this.db
      .select({ id: alerts.id, enrichmentVersion: alerts.enrichmentVersion, escalatedAt: alerts.escalatedAt })
      .from(alerts)
      .where(
        and(
          eq(alerts.aiStatus, 'PENDING'),
          lt(alerts.updatedAt, sql`now() - make_interval(secs => ${olderThanSeconds})`),
        ),
      )
      .orderBy(alerts.updatedAt)
      .limit(limit);
  }

  /** Auto-resolve (§13.4): ACTIVE alerts with no recurrence for `minutes`. */
  autoResolveInactive(minutes: number, note: string): Promise<AlertRow[]> {
    return this.db
      .update(alerts)
      .set({ status: 'RESOLVED', resolvedAt: new Date(), resolutionSource: 'AUTO', resolutionNote: note })
      .where(
        and(
          eq(alerts.status, 'ACTIVE'),
          lt(alerts.lastSeenAt, sql`now() - make_interval(mins => ${minutes})`),
        ),
      )
      .returning();
  }

  /** Writes AI (or template) text only if the alert is still PENDING at this version (§9.1). */
  async applyEnrichment(
    id: string,
    enrichmentVersion: number,
    update: EnrichmentUpdate,
  ): Promise<AlertRow | undefined> {
    const [row] = await this.db
      .update(alerts)
      .set({
        alertMessage: update.text.alertMessage,
        probableCause: update.text.probableCause,
        recommendedAction: update.text.recommendedAction,
        aiStatus: update.aiStatus,
        aiProvider: update.provider,
        aiModel: update.model,
        aiPromptVersion: update.promptVersion,
        aiGeneratedAt: new Date(),
      })
      .where(
        and(
          eq(alerts.id, id),
          eq(alerts.enrichmentVersion, enrichmentVersion),
          eq(alerts.aiStatus, 'PENDING'),
        ),
      )
      .returning();
    return row;
  }

  /** Re-arms AI enrichment: PENDING + new enrichment version (§9.8). */
  async markForRegeneration(id: string): Promise<AlertRow | undefined> {
    const [row] = await this.db
      .update(alerts)
      .set({ aiStatus: 'PENDING', enrichmentVersion: sql`${alerts.enrichmentVersion} + 1` })
      .where(eq(alerts.id, id))
      .returning();
    return row;
  }
}
