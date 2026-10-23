import {
  API_NAME_PATTERN,
  TELEMETRY_LIMITS,
  type FieldIssue,
  type FieldProblem,
  type MetricField,
  type RejectReason,
} from '@apimon/shared';
import type { NormalizedTelemetry } from './anomaly-engine/types';

export interface RejectedItem {
  index: number;
  reason: RejectReason;
  /** Field names and messages only — never values (telemetry may carry PHI). */
  fieldErrors: { field: string; message: string }[];
}

export interface NormalizationResult {
  valid: NormalizedTelemetry[];
  rejected: RejectedItem[];
  /** Items whose observed_at was unusable and replaced by the receive time (debug only). */
  observedAtIgnored: number[];
}

const ISO_WITH_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type MetricCheck = { value: number } | { problem: FieldProblem };

/** Numeric strings ("500") are wrong_type, never coerced. */
const checkMetric = (
  raw: unknown,
  { integer, min, max }: { integer: boolean; min: number; max: number },
): MetricCheck => {
  if (raw === undefined || raw === null) return { problem: 'missing' };
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { problem: 'wrong_type' };
  if (integer && !Number.isInteger(raw)) return { problem: 'not_integer' };
  if (raw < min || raw > max) return { problem: 'out_of_range' };
  return { value: raw };
};

const METRIC_RULES: Record<MetricField, { integer: boolean; min: number; max: number }> = {
  status_code: { integer: true, min: TELEMETRY_LIMITS.statusCodeMin, max: TELEMETRY_LIMITS.statusCodeMax },
  response_time_ms: { integer: false, min: 0, max: TELEMETRY_LIMITS.responseTimeMaxMs },
  records_returned: { integer: true, min: 0, max: TELEMETRY_LIMITS.recordsMax },
};

const parseObservedAt = (raw: unknown, receivedAt: Date): Date | null => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || !ISO_WITH_TIMEZONE.test(raw)) return null;
  const time = Date.parse(raw);
  if (Number.isNaN(time)) return null;
  if (time > receivedAt.getTime() + TELEMETRY_LIMITS.maxFutureSkewMs) return null;
  return new Date(time);
};

export type NormalizeOutcome =
  | { kind: 'valid'; telemetry: NormalizedTelemetry; observedAtIgnored: boolean }
  | { kind: 'rejected'; rejected: RejectedItem };

/**
 * Three tiers (§6.2): an item is rejected only if it cannot be attributed to an API;
 * anything attributable but wrong becomes an INVALID_METRICS / MISSING_RECORDS anomaly.
 * Unknown keys are dropped here and never stored or logged. Pure: `receivedAt` is injected.
 */
export const normalizeItem = (item: unknown, index: number, receivedAt: Date): NormalizeOutcome => {
  if (!isPlainObject(item)) {
    return {
      kind: 'rejected',
      rejected: {
        index,
        reason: 'INVALID_ITEM',
        fieldErrors: [{ field: 'item', message: 'must be a JSON object' }],
      },
    };
  }

  const rawName = item.api_name;
  const apiName = typeof rawName === 'string' ? rawName.trim() : null;
  if (apiName === null || !API_NAME_PATTERN.test(apiName)) {
    const message =
      rawName === undefined || rawName === null
        ? 'is required'
        : typeof rawName !== 'string'
          ? 'must be a string'
          : 'must be 1–120 characters: letters, digits, ".", "_" or "-", starting with a letter or digit';
    return {
      kind: 'rejected',
      rejected: { index, reason: 'INVALID_API_NAME', fieldErrors: [{ field: 'api_name', message }] },
    };
  }

  const issues: FieldIssue[] = [];
  const metric = (field: MetricField): number | null => {
    const check = checkMetric(item[field], METRIC_RULES[field]);
    if ('problem' in check) {
      issues.push({ field, problem: check.problem });
      return null;
    }
    return check.value;
  };

  const statusCode = metric('status_code');
  const rawLatency = metric('response_time_ms');
  const recordsReturned = metric('records_returned');
  const observedAt = parseObservedAt(item.observed_at, receivedAt);

  return {
    kind: 'valid',
    telemetry: {
      index,
      apiName,
      statusCode,
      responseTimeMs: rawLatency === null ? null : Math.round(rawLatency),
      recordsReturned,
      observedAt: observedAt ?? receivedAt,
      issues,
    },
    observedAtIgnored: observedAt === null && item.observed_at !== undefined,
  };
};

export const normalizeItems = (items: readonly unknown[], receivedAt: Date): NormalizationResult => {
  const result: NormalizationResult = { valid: [], rejected: [], observedAtIgnored: [] };
  items.forEach((item, index) => {
    const outcome = normalizeItem(item, index, receivedAt);
    if (outcome.kind === 'rejected') {
      result.rejected.push(outcome.rejected);
      return;
    }
    result.valid.push(outcome.telemetry);
    if (outcome.observedAtIgnored) result.observedAtIgnored.push(index);
  });
  return result;
};
