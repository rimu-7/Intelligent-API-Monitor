/** Anomaly codes, severities and their display metadata (§7). */

export const ANOMALY_CODES = [
  'SERVER_ERROR',
  'AUTH_FAILURE',
  'CLIENT_ERROR',
  'UNEXPECTED_STATUS',
  'HIGH_LATENCY',
  'ZERO_RECORDS',
  'MISSING_RECORDS',
  'INVALID_METRICS',
] as const;
export type AnomalyCode = (typeof ANOMALY_CODES)[number];

/**
 * Display order and template precedence (§7.2). Index 0 is the highest priority:
 * it drives the template impact sentence.
 */
export const ANOMALY_PRIORITY: readonly AnomalyCode[] = [
  'SERVER_ERROR',
  'AUTH_FAILURE',
  'INVALID_METRICS',
  'CLIENT_ERROR',
  'HIGH_LATENCY',
  'MISSING_RECORDS',
  'ZERO_RECORDS',
  'UNEXPECTED_STATUS',
];

/** Declared low → high, matching the Postgres `alert_severity` enum order. */
export const SEVERITIES = ['WARNING', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const severityRank = (severity: Severity): number => SEVERITIES.indexOf(severity);

export const maxSeverity = (a: Severity, b: Severity): Severity =>
  severityRank(a) >= severityRank(b) ? a : b;

export const isAnomalyCode = (value: unknown): value is AnomalyCode =>
  typeof value === 'string' && (ANOMALY_CODES as readonly string[]).includes(value);

export const sortByPriority = (codes: Iterable<AnomalyCode>): AnomalyCode[] =>
  [...new Set(codes)].sort((a, b) => ANOMALY_PRIORITY.indexOf(a) - ANOMALY_PRIORITY.indexOf(b));

export const ANOMALY_LABELS: Readonly<Record<AnomalyCode, string>> = {
  SERVER_ERROR: 'Server error',
  AUTH_FAILURE: 'Authentication failure',
  CLIENT_ERROR: 'Client error',
  UNEXPECTED_STATUS: 'Unexpected status',
  HIGH_LATENCY: 'High latency',
  ZERO_RECORDS: 'Zero records',
  MISSING_RECORDS: 'Missing record count',
  INVALID_METRICS: 'Invalid telemetry',
};

export const ANOMALY_DESCRIPTIONS: Readonly<Record<AnomalyCode, string>> = {
  SERVER_ERROR: 'HTTP status 500–599.',
  AUTH_FAILURE: 'HTTP status 401 or 403.',
  CLIENT_ERROR: 'HTTP status 400–499 other than 401/403 (includes 429).',
  UNEXPECTED_STATUS: 'HTTP status 100–199 or 300–399 for a data request.',
  HIGH_LATENCY: 'Response time at or above the warning (WARNING) or critical (CRITICAL) threshold.',
  ZERO_RECORDS: 'records_returned is 0 for a non-204 response on an API that expects records.',
  MISSING_RECORDS: 'records_returned is missing for a non-204 response on an API that expects records.',
  INVALID_METRICS: 'A metric is present but malformed, or status/latency is missing.',
};
