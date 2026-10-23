import {
  MAX_ALERT_EVENTS_PER_RUN,
  type AlertDto,
  type AnomalyCode,
  type MonitorRunDto,
  type RejectedItemDto,
  type Severity,
  type TelemetrySource,
} from '@apimon/shared';
import type { Env } from '../../config/env';
import type { Logger } from '../../infrastructure/logger';
import type { PromptContext } from '../../infrastructure/queue/job-names';
import type { Queues } from '../../infrastructure/queue/queues';
import { principalLabel, type Principal } from '../../http/principal';
import { UnprocessableError } from '../../lib/errors';
import { buildTemplateAlert } from '../ai/template-alert';
import { toAlertDto, toMonitorRunDto } from '../alerts/alerts.mapper';
import type { AlertsRepository } from '../alerts/alerts.repository';
import type { EventBus } from '../realtime/event-bus';
import type { SimulatorClient } from '../simulator/simulator.client';
import { evaluate } from './anomaly-engine/evaluate';
import { aggregateIncidents, type EvaluatedTelemetry } from './incident-aggregator';
import type {
  AlertUpsertRow,
  MonitoringRepository,
  TelemetryLogInsert,
  UpsertedAlert,
} from './monitoring.repository';
import { parseEnvelope } from './monitoring.schemas';
import type { StaticSources } from './static-sources';
import { normalizeItems, type RejectedItem } from './telemetry-normalizer';
import type { ThresholdsService } from './thresholds.service';

export interface IngestContext {
  source: TelemetrySource;
  sourceDetail?: string;
  principal: Principal;
  requestId?: string;
}

export type ItemResult =
  | { index: number; api_name: string; status: 'healthy' }
  | {
      index: number;
      api_name: string;
      status: 'anomalous';
      severity: Severity;
      anomaly_types: AnomalyCode[];
      alert_id: string | null;
    };

export interface IngestResponse {
  run_id: string;
  source: TelemetrySource;
  source_detail: string | null;
  received: number;
  processed: number;
  healthy: number;
  anomalous: number;
  rejected: number;
  alerts_created: number;
  alerts_updated: number;
  results: ItemResult[];
  rejected_items: RejectedItemDto[];
  alerts: AlertDto[];
}

export interface MonitoringServiceDeps {
  env: Env;
  repository: MonitoringRepository;
  alerts: AlertsRepository;
  thresholds: ThresholdsService;
  queues: Queues;
  events: EventBus;
  staticSources: StaticSources;
  simulator: SimulatorClient;
  logger: Logger;
}

const toRejectedDto = (item: RejectedItem): RejectedItemDto => ({
  index: item.index,
  reason: item.reason,
  field_errors: item.fieldErrors,
});

const promptContextOf = (alert: UpsertedAlert): PromptContext =>
  alert.inserted
    ? 'new_incident'
    : alert.escalated || alert.enrichmentVersion > 1
      ? 'escalation'
      : 'new_incident';

/**
 * The ingestion pipeline (§8.1): envelope → normalize → thresholds → evaluate → aggregate →
 * one transaction → enqueue AI + publish events → optional short wait for AI text → respond.
 */
export class MonitoringService {
  constructor(private readonly deps: MonitoringServiceDeps) {}

  async ingest(body: unknown, context: IngestContext): Promise<IngestResponse> {
    const { env, repository, thresholds, logger } = this.deps;
    const startedAt = performance.now();
    const receivedAt = new Date();

    // 1–2. Envelope and normalization.
    const envelope = parseEnvelope(body, env.MAX_BATCH_SIZE);
    const sourceDetail = context.sourceDetail ?? envelope.sourceDetail;
    // The simulator pushes with the ingest key and labels its batches "simulator:<scenario>".
    const source: TelemetrySource =
      context.source === 'api' &&
      context.principal.kind === 'service' &&
      sourceDetail?.startsWith('simulator')
        ? 'simulator'
        : context.source;
    const normalized = normalizeItems(envelope.items, receivedAt);
    if (normalized.observedAtIgnored.length > 0) {
      logger.debug({ indexes: normalized.observedAtIgnored }, 'observed_at ignored; using receive time');
    }

    // 3–5. Thresholds, pure evaluation, aggregation by fingerprint.
    const apiThresholds = await thresholds.getThresholds(normalized.valid.map((t) => t.apiName));
    const evaluated: EvaluatedTelemetry[] = normalized.valid.map((telemetry) => {
      const th = apiThresholds.get(telemetry.apiName) ?? thresholds.merge(undefined);
      return { telemetry, evaluation: evaluate(telemetry, th), thresholds: th };
    });
    const groups = aggregateIncidents(evaluated);

    const alertRows: AlertUpsertRow[] = groups.map((group) => {
      const text = buildTemplateAlert({
        apiName: group.apiName,
        statusCode: group.trigger.statusCode,
        responseTimeMs: group.trigger.responseTimeMs,
        recordsReturned: group.trigger.recordsReturned,
        codes: group.codes,
        issues: group.trigger.issues,
        latencyWarningMs: group.thresholds.latencyWarningMs,
      });
      return {
        fingerprint: group.fingerprint,
        apiName: group.apiName,
        severity: group.severity,
        anomalyTypes: group.codes,
        statusCode: group.trigger.statusCode,
        responseTimeMs: group.trigger.responseTimeMs,
        recordsReturned: group.trigger.recordsReturned,
        lastStatusCode: group.latest.statusCode,
        lastResponseTimeMs: group.latest.responseTimeMs,
        lastRecordsReturned: group.latest.recordsReturned,
        peakResponseTimeMs: group.peakResponseTimeMs,
        occurrenceCount: group.count,
        alertMessage: text.alertMessage,
        probableCause: text.probableCause,
        recommendedAction: text.recommendedAction,
        firstSeenAt: group.firstSeenAt,
        lastSeenAt: group.lastSeenAt,
      };
    });

    const apiSeen = new Map<string, { name: string; firstSeenAt: Date; lastSeenAt: Date }>();
    for (const { apiName, observedAt } of normalized.valid) {
      const seen = apiSeen.get(apiName);
      if (!seen) apiSeen.set(apiName, { name: apiName, firstSeenAt: observedAt, lastSeenAt: observedAt });
      else {
        if (observedAt < seen.firstSeenAt) seen.firstSeenAt = observedAt;
        if (observedAt > seen.lastSeenAt) seen.lastSeenAt = observedAt;
      }
    }

    const telemetryRows: TelemetryLogInsert[] = evaluated.map(({ telemetry, evaluation }) => ({
      apiName: telemetry.apiName,
      statusCode: telemetry.statusCode,
      responseTimeMs: telemetry.responseTimeMs,
      recordsReturned: telemetry.recordsReturned,
      isAnomalous: evaluation.isAnomalous,
      severity: evaluation.severity,
      anomalyTypes: evaluation.codes,
      fingerprint: evaluation.fingerprint,
      observedAt: telemetry.observedAt,
    }));

    const anomalous = evaluated.filter((item) => item.evaluation.isAnomalous).length;

    // 6. One transaction.
    const persisted = await repository.persistRun({
      run: {
        source,
        sourceDetail,
        principal: principalLabel(context.principal),
        requestId: context.requestId ?? null,
        received: envelope.items.length,
        processed: normalized.valid.length,
        healthy: normalized.valid.length - anomalous,
        anomalous,
        rejected: normalized.rejected.length,
      },
      apis: [...apiSeen.values()],
      alerts: alertRows,
      telemetry: telemetryRows,
      rejected: normalized.rejected,
      notifications: { enabled: env.EMAIL_ENABLED, minSeverity: env.ALERT_EMAIL_MIN_SEVERITY },
      startedAt,
    });

    if (normalized.valid.length === 0) {
      logger.info(
        {
          event: 'monitor.run.completed',
          run_id: persisted.runId,
          received: envelope.items.length,
          rejected: normalized.rejected.length,
        },
        'ingestion rejected every item',
      );
      await this.publishRun(persisted.runId);
      throw new UnprocessableError('No telemetry item could be attributed to an API', 'ALL_ITEMS_REJECTED', {
        run_id: persisted.runId,
        rejected_items: normalized.rejected.map(toRejectedDto),
      });
    }

    // 7. After commit: AI jobs and realtime events (failures here never fail the request).
    const pending = persisted.alerts.filter((alert) => alert.aiStatus === 'PENDING');
    const jobIds = await this.enqueueEnrichment(pending, context.requestId);
    let alertDtos = await this.loadAlerts(persisted.alerts.map((alert) => alert.id));
    await this.publishAlertEvents(persisted.alerts, alertDtos);
    const run = await this.publishRun(persisted.runId);

    // 8. Optional short wait so small requests answer with AI text.
    if (env.AI_SYNC_WAIT_MS > 0 && jobIds.length > 0 && pending.length <= env.AI_SYNC_MAX_ALERTS) {
      await this.deps.queues.waitForAiJobs(jobIds, env.AI_SYNC_WAIT_MS);
      alertDtos = await this.loadAlerts(persisted.alerts.map((alert) => alert.id));
    }

    // 9. Respond.
    const alertIdByFingerprint = new Map(persisted.alerts.map((alert) => [alert.fingerprint, alert.id]));
    const results: ItemResult[] = evaluated
      .map(({ telemetry, evaluation }): ItemResult =>
        evaluation.isAnomalous && evaluation.severity
          ? {
              index: telemetry.index,
              api_name: telemetry.apiName,
              status: 'anomalous',
              severity: evaluation.severity,
              anomaly_types: evaluation.codes,
              alert_id: evaluation.fingerprint
                ? (alertIdByFingerprint.get(evaluation.fingerprint) ?? null)
                : null,
            }
          : { index: telemetry.index, api_name: telemetry.apiName, status: 'healthy' },
      )
      .sort((a, b) => a.index - b.index);

    const created = persisted.alerts.filter((alert) => alert.inserted).length;
    const response: IngestResponse = {
      run_id: persisted.runId,
      source,
      source_detail: sourceDetail,
      received: envelope.items.length,
      processed: normalized.valid.length,
      healthy: normalized.valid.length - anomalous,
      anomalous,
      rejected: normalized.rejected.length,
      alerts_created: created,
      alerts_updated: persisted.alerts.length - created,
      results,
      rejected_items: normalized.rejected.map(toRejectedDto),
      alerts: alertDtos,
    };

    logger.info(
      {
        event: 'monitor.run.completed',
        run_id: persisted.runId,
        source,
        received: response.received,
        processed: response.processed,
        healthy: response.healthy,
        anomalous: response.anomalous,
        rejected: response.rejected,
        alerts_created: response.alerts_created,
        alerts_updated: response.alerts_updated,
        duration_ms: run?.duration_ms ?? null,
      },
      'monitor run completed',
    );
    for (const alert of persisted.alerts) {
      if (alert.inserted)
        logger.info(
          { event: 'alert.created', alert_id: alert.id, severity: alert.severity },
          'alert created',
        );
      if (alert.escalated) {
        logger.info(
          { event: 'alert.escalated', alert_id: alert.id, from: alert.previousSeverity, to: alert.severity },
          'alert escalated',
        );
      }
    }
    return response;
  }

  async ingestStaticFile(
    file: string,
    context: Omit<IngestContext, 'source' | 'sourceDetail'>,
  ): Promise<IngestResponse> {
    const body = await this.deps.staticSources.read(file);
    return this.ingest(body, { ...context, source: 'static_file', sourceDetail: file });
  }

  async fetchLive(
    count: number,
    context: Omit<IngestContext, 'source' | 'sourceDetail'>,
  ): Promise<IngestResponse> {
    const items = await this.deps.simulator.fetchTelemetry(count);
    return this.ingest(items, { ...context, source: 'live_pull', sourceDetail: 'telemetry-simulator' });
  }

  listStaticFiles(): string[] {
    return this.deps.staticSources.list();
  }

  async listRuns(limit: number): Promise<MonitorRunDto[]> {
    return (await this.deps.repository.listRuns(limit)).map(toMonitorRunDto);
  }

  private async loadAlerts(ids: string[]): Promise<AlertDto[]> {
    const rows = await this.deps.alerts.findByIds(ids);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toAlertDto(row)] : [];
    });
  }

  /** If Redis is down the jobs are skipped here; the reconciler re-enqueues stuck PENDING alerts. */
  private async enqueueEnrichment(
    pending: UpsertedAlert[],
    requestId: string | undefined,
  ): Promise<string[]> {
    const jobIds: string[] = [];
    await Promise.all(
      pending.map(async (alert) => {
        try {
          jobIds.push(
            await this.deps.queues.enqueueAi({
              alertId: alert.id,
              enrichmentVersion: alert.enrichmentVersion,
              context: promptContextOf(alert),
              ...(requestId ? { requestId } : {}),
            }),
          );
        } catch (err) {
          this.deps.logger.error(
            { err, alert_id: alert.id },
            'failed to enqueue AI enrichment; reconciler will retry',
          );
        }
      }),
    );
    return jobIds;
  }

  private async publishAlertEvents(upserted: UpsertedAlert[], dtos: AlertDto[]): Promise<void> {
    const { events } = this.deps;
    if (upserted.length === 0) return;
    if (upserted.length > MAX_ALERT_EVENTS_PER_RUN) {
      await events.publish('alerts.invalidated', { reason: 'bulk_ingest', count: upserted.length });
      return;
    }
    const insertedIds = new Set(upserted.filter((alert) => alert.inserted).map((alert) => alert.id));
    await Promise.all(
      dtos.map((alert) =>
        events.publish(insertedIds.has(alert.id) ? 'alert.created' : 'alert.updated', { alert }),
      ),
    );
  }

  private async publishRun(runId: string): Promise<MonitorRunDto | undefined> {
    const row = await this.deps.repository.findRun(runId);
    if (!row) return undefined;
    const run = toMonitorRunDto(row);
    await this.deps.events.publish('monitor.run.completed', { run });
    return run;
  }
}
