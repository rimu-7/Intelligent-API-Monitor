import type { AnomalyCode, Severity } from './anomaly';
import type { TelemetrySource } from './telemetry';

export const ALERT_STATUSES = ['ACTIVE', 'RESOLVED'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** SKIPPED: AI was not requested (no email for this incident); the rule-based text stands until someone asks. */
export const AI_STATUSES = ['PENDING', 'COMPLETED', 'FALLBACK', 'SKIPPED'] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

export const LLM_PROVIDER_NAMES = ['gemini', 'openai', 'mistral'] as const;
export type LlmProviderName = (typeof LLM_PROVIDER_NAMES)[number];
export type AiProvider = LlmProviderName | 'template';

export const RESOLUTION_SOURCES = ['MANUAL', 'AUTO'] as const;
export type ResolutionSource = (typeof RESOLUTION_SOURCES)[number];

/** Public alert representation (§11.4). snake_case on the wire. */
export interface AlertDto {
  id: string;
  api_name: string;
  status: AlertStatus;
  severity: Severity;
  previous_severity: Severity | null;
  anomaly_types: AnomalyCode[];
  alert_message: string;
  probable_cause: string;
  recommended_action: string;
  status_code: number | null;
  response_time_ms: number | null;
  records_returned: number | null;
  last_status_code: number | null;
  last_response_time_ms: number | null;
  last_records_returned: number | null;
  peak_response_time_ms: number | null;
  occurrence_count: number;
  ai_status: AiStatus;
  ai_provider: AiProvider | null;
  ai_model: string | null;
  ai_generated_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  escalated_at: string | null;
  resolved_at: string | null;
  resolution_source: ResolutionSource | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface TelemetrySampleDto {
  id: number;
  status_code: number | null;
  response_time_ms: number | null;
  records_returned: number | null;
  severity: Severity | null;
  anomaly_types: AnomalyCode[];
  observed_at: string;
  received_at: string;
}

export interface AlertDetailDto extends AlertDto {
  recent_samples: TelemetrySampleDto[];
}

export interface AlertSummaryDto {
  active: { total: number; critical: number; warning: number };
  resolved: number;
  top_apis: { api_name: string; active_alerts: number; critical: number }[];
  generated_at: string;
}

export interface MonitorRunDto {
  id: string;
  source: TelemetrySource;
  source_detail: string | null;
  principal: string;
  received: number;
  processed: number;
  healthy: number;
  anomalous: number;
  rejected: number;
  alerts_created: number;
  alerts_updated: number;
  duration_ms: number | null;
  request_id: string | null;
  created_at: string;
}

export interface MonitoredApiDto {
  name: string;
  latency_warning_ms: number;
  latency_critical_ms: number;
  expects_records: boolean;
  uses_default_thresholds: boolean;
  first_seen_at: string;
  last_seen_at: string;
  last_hour: { requests: number; error_rate: number; p95_latency_ms: number | null };
  active_alerts: number;
}
