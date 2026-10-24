import {
  isAnomalyCode,
  type AiProvider,
  type AlertDetailDto,
  type AlertDto,
  type MonitorRunDto,
  type TelemetrySampleDto,
  type TelemetrySource,
} from '@apimon/shared';
import type { AlertRow, MonitorRunRow, TelemetryLogRow } from '../../infrastructure/database/schema';

const iso = (date: Date | null) => date?.toISOString() ?? null;
const codes = (values: readonly string[]) => values.filter(isAnomalyCode);

export const toAlertDto = (row: AlertRow): AlertDto => ({
  id: row.id,
  api_name: row.apiName,
  status: row.status,
  severity: row.severity,
  previous_severity: row.previousSeverity,
  anomaly_types: codes(row.anomalyTypes),
  alert_message: row.alertMessage,
  probable_cause: row.probableCause,
  recommended_action: row.recommendedAction,
  status_code: row.statusCode,
  response_time_ms: row.responseTimeMs,
  records_returned: row.recordsReturned,
  last_status_code: row.lastStatusCode,
  last_response_time_ms: row.lastResponseTimeMs,
  last_records_returned: row.lastRecordsReturned,
  peak_response_time_ms: row.peakResponseTimeMs,
  occurrence_count: row.occurrenceCount,
  ai_status: row.aiStatus,
  ai_provider: (row.aiProvider as AiProvider | null) ?? null,
  ai_model: row.aiModel,
  ai_generated_at: iso(row.aiGeneratedAt),
  first_seen_at: row.firstSeenAt.toISOString(),
  last_seen_at: row.lastSeenAt.toISOString(),
  escalated_at: iso(row.escalatedAt),
  resolved_at: iso(row.resolvedAt),
  resolution_source: row.resolutionSource,
  resolution_note: row.resolutionNote,
  created_at: row.createdAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
});

export const toSampleDto = (row: TelemetryLogRow): TelemetrySampleDto => ({
  id: row.id,
  status_code: row.statusCode,
  response_time_ms: row.responseTimeMs,
  records_returned: row.recordsReturned,
  severity: row.severity,
  anomaly_types: codes(row.anomalyTypes),
  observed_at: row.observedAt.toISOString(),
  received_at: row.receivedAt.toISOString(),
});

export const toAlertDetailDto = (row: AlertRow, samples: TelemetryLogRow[]): AlertDetailDto => ({
  ...toAlertDto(row),
  recent_samples: samples.map(toSampleDto),
});

export const toMonitorRunDto = (row: MonitorRunRow): MonitorRunDto => ({
  id: row.id,
  source: row.source as TelemetrySource,
  source_detail: row.sourceDetail,
  principal: row.principal,
  received: row.received,
  processed: row.processed,
  healthy: row.healthy,
  anomalous: row.anomalous,
  rejected: row.rejected,
  alerts_created: row.alertsCreated,
  alerts_updated: row.alertsUpdated,
  duration_ms: row.durationMs,
  request_id: row.requestId,
  created_at: row.createdAt.toISOString(),
});
