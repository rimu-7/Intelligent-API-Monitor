import type { AnomalyCode, FieldIssue, Severity } from '@apimon/shared';

/** One attributable telemetry item after normalization (§6.2). Invalid metrics are null + an issue. */
export interface NormalizedTelemetry {
  /** Position in the request. */
  index: number;
  apiName: string;
  statusCode: number | null;
  responseTimeMs: number | null;
  recordsReturned: number | null;
  observedAt: Date;
  issues: FieldIssue[];
}

export interface Thresholds {
  latencyWarningMs: number;
  latencyCriticalMs: number;
  expectsRecords: boolean;
}

export interface Anomaly {
  code: AnomalyCode;
  severity: Severity;
  /** Short factual text, e.g. "5500 ms ≥ critical threshold 5000 ms". */
  detail: string;
}

export interface Evaluation {
  isAnomalous: boolean;
  /** Max of anomaly severities. */
  severity: Severity | null;
  /** Ordered by ANOMALY_PRIORITY. */
  anomalies: Anomaly[];
  /** Ordered by ANOMALY_PRIORITY. */
  codes: AnomalyCode[];
  fingerprint: string | null;
}
