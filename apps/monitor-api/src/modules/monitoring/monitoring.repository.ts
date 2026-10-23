import {
  isAnomalyCode,
  severityRank,
  type AnomalyCode,
  type Severity,
  type TelemetrySource,
} from '@apimon/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../infrastructure/database/client';
import {
  alertNotifications,
  monitoredApis,
  monitorRuns,
  rejectedTelemetry,
  telemetryLogs,
  type MonitorRunRow,
} from '../../infrastructure/database/schema';
import { runInTransaction, type Transaction } from '../../infrastructure/database/transaction';
import type { Logger } from '../../infrastructure/logger';
import { chunk } from '../../lib/chunk';
import type { RejectedItem } from './telemetry-normalizer';

/** ≤ 500 rows per multi-row statement keeps far below the 65,535 bind-parameter limit (§21.5). */
const CHUNK_SIZE = 500;

export interface AlertUpsertRow {
  fingerprint: string;
  apiName: string;
  severity: Severity;
  anomalyTypes: AnomalyCode[];
  statusCode: number | null;
  responseTimeMs: number | null;
  recordsReturned: number | null;
  lastStatusCode: number | null;
  lastResponseTimeMs: number | null;
  lastRecordsReturned: number | null;
  peakResponseTimeMs: number | null;
  occurrenceCount: number;
  alertMessage: string;
  probableCause: string;
  recommendedAction: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface TelemetryLogInsert {
  apiName: string;
  statusCode: number | null;
  responseTimeMs: number | null;
  recordsReturned: number | null;
  isAnomalous: boolean;
  severity: Severity | null;
  anomalyTypes: AnomalyCode[];
  /** Links the log to its alert once the upsert returns ids. */
  fingerprint: string | null;
  observedAt: Date;
}

export interface PersistRunInput {
  run: {
    source: TelemetrySource;
    sourceDetail: string | null;
    principal: string;
    requestId: string | null;
    received: number;
    processed: number;
    healthy: number;
    anomalous: number;
    rejected: number;
  };
  apis: { name: string; firstSeenAt: Date; lastSeenAt: Date }[];
  /** Sorted by fingerprint, one row per fingerprint. */
  alerts: AlertUpsertRow[];
  telemetry: TelemetryLogInsert[];
  rejected: RejectedItem[];
  notifications: { enabled: boolean; minSeverity: Severity };
  startedAt: number;
}

export interface UpsertedAlert {
  id: string;
  fingerprint: string;
  severity: Severity;
  previousSeverity: Severity | null;
  aiStatus: 'PENDING' | 'COMPLETED' | 'FALLBACK';
  enrichmentVersion: number;
  inserted: boolean;
  escalated: boolean;
}

export interface PersistRunResult {
  runId: string;
  alerts: UpsertedAlert[];
}

const isSeverity = (value: unknown): value is Severity => value === 'WARNING' || value === 'CRITICAL';
const isAiStatus = (value: unknown): value is UpsertedAlert['aiStatus'] =>
  value === 'PENDING' || value === 'COMPLETED' || value === 'FALLBACK';

/** Codes are enum values, so a literal `{A,B}` array is safe and avoids driver array quirks. */
const textArray = (codes: readonly AnomalyCode[]) => `{${codes.filter(isAnomalyCode).join(',')}}`;

/**
 * Persists one ingestion run atomically (§8.1 step 6). Retried on deadlock/serialization failure.
 */
export class MonitoringRepository {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  persistRun(input: PersistRunInput): Promise<PersistRunResult> {
    return runInTransaction(this.db, this.logger, (tx) => this.persistInTransaction(tx, input));
  }

  private async persistInTransaction(tx: Transaction, input: PersistRunInput): Promise<PersistRunResult> {
    // 1. Run row (counts are known up front).
    const [run] = await tx
      .insert(monitorRuns)
      .values({ ...input.run })
      .returning({ id: monitorRuns.id });
    if (!run) throw new Error('monitor_runs insert returned no row');

    // 2. API registry, in name order (consistent lock order).
    for (const batch of chunk(
      [...input.apis].sort((a, b) => (a.name < b.name ? -1 : 1)),
      CHUNK_SIZE,
    )) {
      await tx
        .insert(monitoredApis)
        .values(batch)
        .onConflictDoUpdate({
          target: monitoredApis.name,
          set: { lastSeenAt: sql`GREATEST(${monitoredApis.lastSeenAt}, excluded.last_seen_at)` },
        });
    }

    // 3. Alert upserts, in fingerprint order.
    const upserted: UpsertedAlert[] = [];
    for (const batch of chunk(input.alerts, CHUNK_SIZE))
      upserted.push(...(await this.upsertAlerts(tx, batch)));
    const alertIdByFingerprint = new Map(upserted.map((alert) => [alert.fingerprint, alert.id]));

    // 4. Telemetry logs, linked to their alert.
    for (const batch of chunk(input.telemetry, CHUNK_SIZE)) {
      await tx.insert(telemetryLogs).values(
        batch.map(({ fingerprint, ...log }) => ({
          ...log,
          runId: run.id,
          alertId: fingerprint ? (alertIdByFingerprint.get(fingerprint) ?? null) : null,
        })),
      );
    }

    // 5. Rejected items — field names and messages only, never values.
    for (const batch of chunk(input.rejected, CHUNK_SIZE)) {
      await tx.insert(rejectedTelemetry).values(
        batch.map((item) => ({
          runId: run.id,
          itemIndex: item.index,
          reason: item.reason,
          fieldErrors: item.fieldErrors,
        })),
      );
    }

    // 6. Notifications for new and escalated incidents at or above the email threshold.
    if (input.notifications.enabled) {
      const minRank = severityRank(input.notifications.minSeverity);
      const due = upserted
        .filter((alert) => (alert.inserted || alert.escalated) && severityRank(alert.severity) >= minRank)
        .map((alert) => ({
          alertId: alert.id,
          reason: alert.inserted ? ('NEW' as const) : ('ESCALATED' as const),
        }));
      if (due.length > 0) await tx.insert(alertNotifications).values(due).onConflictDoNothing();
    }

    // 7. Final counts and duration.
    const created = upserted.filter((alert) => alert.inserted).length;
    await tx
      .update(monitorRuns)
      .set({
        alertsCreated: created,
        alertsUpdated: upserted.length - created,
        durationMs: Math.max(0, Math.round(performance.now() - input.startedAt)),
      })
      .where(eq(monitorRuns.id, run.id));

    return { runId: run.id, alerts: upserted };
  }

  /**
   * §8.2: the conflict target repeats the partial-index predicate so a RESOLVED incident never
   * matches; an escalation re-anchors the trigger sample and re-arms AI (new enrichment version).
   */
  private async upsertAlerts(tx: DbExecutor, rows: AlertUpsertRow[]): Promise<UpsertedAlert[]> {
    if (rows.length === 0) return [];
    const values = sql.join(
      rows.map(
        (r) => sql`(
          ${r.fingerprint}, ${r.apiName}, ${r.severity}::alert_severity, ${textArray(r.anomalyTypes)}::text[],
          ${r.statusCode}::int, ${r.responseTimeMs}::int, ${r.recordsReturned}::int,
          ${r.lastStatusCode}::int, ${r.lastResponseTimeMs}::int, ${r.lastRecordsReturned}::int,
          ${r.peakResponseTimeMs}::int, ${r.occurrenceCount}::int,
          ${r.alertMessage}, ${r.probableCause}, ${r.recommendedAction},
          'PENDING'::ai_status, 1, ${r.firstSeenAt.toISOString()}::timestamptz, ${r.lastSeenAt.toISOString()}::timestamptz
        )`,
      ),
      sql`, `,
    );

    const result = await tx.execute(sql`
      INSERT INTO alerts AS a (
        fingerprint, api_name, severity, anomaly_types,
        status_code, response_time_ms, records_returned,
        last_status_code, last_response_time_ms, last_records_returned,
        peak_response_time_ms, occurrence_count,
        alert_message, probable_cause, recommended_action,
        ai_status, enrichment_version, first_seen_at, last_seen_at
      ) VALUES ${values}
      ON CONFLICT (fingerprint) WHERE status = 'ACTIVE'
      DO UPDATE SET
        occurrence_count      = a.occurrence_count + EXCLUDED.occurrence_count,
        last_seen_at          = GREATEST(a.last_seen_at, EXCLUDED.last_seen_at),
        last_status_code      = CASE WHEN EXCLUDED.last_seen_at >= a.last_seen_at THEN EXCLUDED.last_status_code      ELSE a.last_status_code      END,
        last_response_time_ms = CASE WHEN EXCLUDED.last_seen_at >= a.last_seen_at THEN EXCLUDED.last_response_time_ms ELSE a.last_response_time_ms END,
        last_records_returned = CASE WHEN EXCLUDED.last_seen_at >= a.last_seen_at THEN EXCLUDED.last_records_returned ELSE a.last_records_returned END,
        peak_response_time_ms = GREATEST(a.peak_response_time_ms, EXCLUDED.peak_response_time_ms),
        previous_severity     = a.severity,
        severity              = GREATEST(a.severity, EXCLUDED.severity),
        status_code        = CASE WHEN EXCLUDED.severity > a.severity THEN EXCLUDED.status_code        ELSE a.status_code        END,
        response_time_ms   = CASE WHEN EXCLUDED.severity > a.severity THEN EXCLUDED.response_time_ms   ELSE a.response_time_ms   END,
        records_returned   = CASE WHEN EXCLUDED.severity > a.severity THEN EXCLUDED.records_returned   ELSE a.records_returned   END,
        alert_message      = CASE WHEN EXCLUDED.severity > a.severity THEN EXCLUDED.alert_message      ELSE a.alert_message      END,
        probable_cause     = CASE WHEN EXCLUDED.severity > a.severity THEN EXCLUDED.probable_cause     ELSE a.probable_cause     END,
        recommended_action = CASE WHEN EXCLUDED.severity > a.severity THEN EXCLUDED.recommended_action ELSE a.recommended_action END,
        ai_status          = CASE WHEN EXCLUDED.severity > a.severity THEN 'PENDING'::ai_status        ELSE a.ai_status          END,
        enrichment_version = CASE WHEN EXCLUDED.severity > a.severity THEN a.enrichment_version + 1   ELSE a.enrichment_version END,
        escalated_at       = CASE WHEN EXCLUDED.severity > a.severity THEN now()                      ELSE a.escalated_at       END,
        updated_at         = now()
      RETURNING id, fingerprint, severity, previous_severity, ai_status, enrichment_version, (xmax = 0) AS inserted
    `);

    return result.rows.map((row) => {
      const severity = row.severity;
      const previous = row.previous_severity;
      const aiStatus = row.ai_status;
      if (
        typeof row.id !== 'string' ||
        typeof row.fingerprint !== 'string' ||
        !isSeverity(severity) ||
        !isAiStatus(aiStatus)
      ) {
        throw new Error('unexpected alert upsert row');
      }
      const inserted = row.inserted === true;
      const previousSeverity = isSeverity(previous) ? previous : null;
      return {
        id: row.id,
        fingerprint: row.fingerprint,
        severity,
        previousSeverity,
        aiStatus,
        enrichmentVersion: Number(row.enrichment_version),
        inserted,
        escalated:
          !inserted && previousSeverity !== null && severityRank(previousSeverity) < severityRank(severity),
      };
    });
  }

  /** Retention (§13.4): deletes up to `batchSize` telemetry logs older than `days`; returns the count. */
  async deleteOldTelemetry(days: number, batchSize: number): Promise<number> {
    const result = await this.db.execute(sql`
      DELETE FROM telemetry_logs WHERE id IN (
        SELECT id FROM telemetry_logs WHERE observed_at < now() - make_interval(days => ${days}) LIMIT ${batchSize}
      )`);
    return result.rowCount ?? 0;
  }

  async deleteOldRejected(days: number, batchSize: number): Promise<number> {
    const result = await this.db.execute(sql`
      DELETE FROM rejected_telemetry WHERE id IN (
        SELECT id FROM rejected_telemetry WHERE received_at < now() - make_interval(days => ${days}) LIMIT ${batchSize}
      )`);
    return result.rowCount ?? 0;
  }

  /** Runs older than `days` with no remaining telemetry or rejected rows. */
  async deleteEmptyOldRuns(days: number): Promise<number> {
    const result = await this.db.execute(sql`
      DELETE FROM monitor_runs r
      WHERE r.created_at < now() - make_interval(days => ${days})
        AND NOT EXISTS (SELECT 1 FROM telemetry_logs l WHERE l.run_id = r.id)
        AND NOT EXISTS (SELECT 1 FROM rejected_telemetry j WHERE j.run_id = r.id)`);
    return result.rowCount ?? 0;
  }

  async listRuns(limit: number): Promise<MonitorRunRow[]> {
    return this.db
      .select()
      .from(monitorRuns)
      .orderBy(desc(monitorRuns.createdAt), desc(monitorRuns.id))
      .limit(limit);
  }

  async findRun(id: string): Promise<MonitorRunRow | undefined> {
    const [row] = await this.db.select().from(monitorRuns).where(eq(monitorRuns.id, id)).limit(1);
    return row;
  }
}
