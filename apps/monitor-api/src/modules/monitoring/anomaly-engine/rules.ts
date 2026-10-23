import type { AnomalyCode } from '@apimon/shared';
import type { Anomaly, NormalizedTelemetry, Thresholds } from './types';

/**
 * Detection rules (§7.2) — the single source of truth, in ANOMALY_PRIORITY order.
 * Every metric is evaluated independently; a null metric skips the rules that need it.
 * Thresholds are inclusive. There is deliberately no combined "latency and failure" rule.
 */
export interface Rule {
  code: AnomalyCode;
  evaluate(t: NormalizedTelemetry, th: Thresholds): Anomaly | null;
}

const between = (value: number | null, min: number, max: number): value is number =>
  value !== null && value >= min && value <= max;

/** records_returned was absent/null (as opposed to present-but-invalid). */
const recordsMissing = (t: NormalizedTelemetry) =>
  t.issues.some((issue) => issue.field === 'records_returned' && issue.problem === 'missing');

/** Everything except "records_returned: missing" counts as invalid telemetry. */
const invalidIssues = (t: NormalizedTelemetry) =>
  t.issues.filter((issue) => !(issue.field === 'records_returned' && issue.problem === 'missing'));

export const RULES: readonly Rule[] = [
  {
    code: 'SERVER_ERROR',
    evaluate: (t) =>
      between(t.statusCode, 500, 599)
        ? { code: 'SERVER_ERROR', severity: 'CRITICAL', detail: `HTTP ${t.statusCode} server error` }
        : null,
  },
  {
    code: 'AUTH_FAILURE',
    evaluate: (t) =>
      t.statusCode === 401 || t.statusCode === 403
        ? {
            code: 'AUTH_FAILURE',
            severity: 'CRITICAL',
            detail: `HTTP ${t.statusCode} authentication failure`,
          }
        : null,
  },
  {
    code: 'INVALID_METRICS',
    evaluate: (t) => {
      const issues = invalidIssues(t);
      if (issues.length === 0) return null;
      const list = issues.map((issue) => `${issue.field} (${issue.problem.replace('_', ' ')})`).join(', ');
      return { code: 'INVALID_METRICS', severity: 'WARNING', detail: `invalid fields: ${list}` };
    },
  },
  {
    code: 'CLIENT_ERROR',
    evaluate: (t) =>
      between(t.statusCode, 400, 499) && t.statusCode !== 401 && t.statusCode !== 403
        ? {
            code: 'CLIENT_ERROR',
            severity: 'WARNING',
            detail: t.statusCode === 429 ? 'HTTP 429 rate limited' : `HTTP ${t.statusCode} client error`,
          }
        : null,
  },
  {
    code: 'HIGH_LATENCY',
    evaluate: (t, th) => {
      if (t.responseTimeMs === null) return null;
      if (t.responseTimeMs >= th.latencyCriticalMs) {
        return {
          code: 'HIGH_LATENCY',
          severity: 'CRITICAL',
          detail: `${t.responseTimeMs} ms ≥ critical threshold ${th.latencyCriticalMs} ms`,
        };
      }
      if (t.responseTimeMs >= th.latencyWarningMs) {
        return {
          code: 'HIGH_LATENCY',
          severity: 'WARNING',
          detail: `${t.responseTimeMs} ms ≥ warning threshold ${th.latencyWarningMs} ms`,
        };
      }
      return null;
    },
  },
  {
    code: 'MISSING_RECORDS',
    evaluate: (t, th) =>
      th.expectsRecords && t.statusCode !== 204 && recordsMissing(t)
        ? { code: 'MISSING_RECORDS', severity: 'WARNING', detail: 'records_returned missing' }
        : null,
  },
  {
    code: 'ZERO_RECORDS',
    evaluate: (t, th) =>
      th.expectsRecords && t.statusCode !== 204 && t.recordsReturned === 0
        ? { code: 'ZERO_RECORDS', severity: 'WARNING', detail: '0 records returned' }
        : null,
  },
  {
    code: 'UNEXPECTED_STATUS',
    evaluate: (t) =>
      between(t.statusCode, 100, 199) || between(t.statusCode, 300, 399)
        ? { code: 'UNEXPECTED_STATUS', severity: 'WARNING', detail: `HTTP ${t.statusCode} unexpected status` }
        : null,
  },
];
