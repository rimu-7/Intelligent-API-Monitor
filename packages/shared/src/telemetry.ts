/** Telemetry input contract (§6). */

/** Security control: blocks prompt injection through the only free-text field that reaches the LLM. */
export const API_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
export const API_NAME_MAX_LENGTH = 120;

export const TELEMETRY_LIMITS = {
  statusCodeMin: 100,
  statusCodeMax: 599,
  responseTimeMaxMs: 3_600_000,
  recordsMax: 10_000_000,
  /** observed_at may be at most this far in the future. */
  maxFutureSkewMs: 5 * 60 * 1000,
  sourceDetailMaxLength: 50,
} as const;

export const TELEMETRY_SOURCES = ['api', 'static_file', 'live_pull', 'simulator'] as const;
export type TelemetrySource = (typeof TELEMETRY_SOURCES)[number];

/** The exact item shape from the assignment PDF (plus optional observed_at). */
export interface RawTelemetryItem {
  api_name: string;
  response_time_ms: number;
  status_code: number;
  records_returned?: number;
  observed_at?: string;
}

export const METRIC_FIELDS = ['status_code', 'response_time_ms', 'records_returned'] as const;
export type MetricField = (typeof METRIC_FIELDS)[number];

export const FIELD_PROBLEMS = ['missing', 'wrong_type', 'not_integer', 'out_of_range'] as const;
export type FieldProblem = (typeof FIELD_PROBLEMS)[number];

export interface FieldIssue {
  field: MetricField;
  problem: FieldProblem;
}

export const REJECT_REASONS = ['INVALID_ITEM', 'INVALID_API_NAME'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export interface RejectedItemDto {
  index: number;
  reason: RejectReason;
  field_errors: { field: string; message: string }[];
}
