import type { AnomalyCode, Severity } from '@apimon/shared';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/modules/monitoring/anomaly-engine/evaluate';
import { fingerprint } from '../../src/modules/monitoring/anomaly-engine/fingerprint';
import { normalizeItem } from '../../src/modules/monitoring/telemetry-normalizer';
import { DEFAULT_THRESHOLDS, OBSERVED } from '../helpers/fixtures';

const MISSING = Symbol('missing');
type Input = number | string | typeof MISSING;

interface Row {
  n: number;
  status: Input;
  ms: Input;
  records: Input;
  codes: AnomalyCode[];
  severity: Severity | null;
  thresholds?: Partial<typeof DEFAULT_THRESHOLDS>;
}

/** §7.4 — default thresholds 2000/5000, expectsRecords true unless noted. */
const TABLE: Row[] = [
  { n: 1, status: 200, ms: 1200, records: 50, codes: [], severity: null },
  {
    n: 2,
    status: 500,
    ms: 5500,
    records: 0,
    codes: ['SERVER_ERROR', 'HIGH_LATENCY', 'ZERO_RECORDS'],
    severity: 'CRITICAL',
  },
  { n: 3, status: 200, ms: 1999, records: 10, codes: [], severity: null },
  { n: 4, status: 200, ms: 2000, records: 10, codes: ['HIGH_LATENCY'], severity: 'WARNING' },
  { n: 5, status: 200, ms: 4999, records: 10, codes: ['HIGH_LATENCY'], severity: 'WARNING' },
  { n: 6, status: 200, ms: 5000, records: 10, codes: ['HIGH_LATENCY'], severity: 'CRITICAL' },
  { n: 7, status: 200, ms: 300, records: 0, codes: ['ZERO_RECORDS'], severity: 'WARNING' },
  { n: 8, status: 204, ms: 300, records: 0, codes: [], severity: null },
  {
    n: 9,
    status: 200,
    ms: 300,
    records: 0,
    codes: [],
    severity: null,
    thresholds: { expectsRecords: false },
  },
  { n: 10, status: 200, ms: 300, records: MISSING, codes: ['MISSING_RECORDS'], severity: 'WARNING' },
  { n: 11, status: 401, ms: 200, records: 0, codes: ['AUTH_FAILURE', 'ZERO_RECORDS'], severity: 'CRITICAL' },
  { n: 12, status: 403, ms: 200, records: 3, codes: ['AUTH_FAILURE'], severity: 'CRITICAL' },
  { n: 13, status: 429, ms: 150, records: 0, codes: ['CLIENT_ERROR', 'ZERO_RECORDS'], severity: 'WARNING' },
  { n: 14, status: 404, ms: 100, records: 0, codes: ['CLIENT_ERROR', 'ZERO_RECORDS'], severity: 'WARNING' },
  { n: 15, status: 302, ms: 100, records: 5, codes: ['UNEXPECTED_STATUS'], severity: 'WARNING' },
  { n: 16, status: 503, ms: 800, records: 12, codes: ['SERVER_ERROR'], severity: 'CRITICAL' },
  { n: 17, status: '500', ms: 300, records: 5, codes: ['INVALID_METRICS'], severity: 'WARNING' },
  { n: 18, status: 700, ms: 300, records: 5, codes: ['INVALID_METRICS'], severity: 'WARNING' },
  { n: 19, status: 200, ms: -1, records: 5, codes: ['INVALID_METRICS'], severity: 'WARNING' },
  { n: 20, status: 200, ms: 300, records: -5, codes: ['INVALID_METRICS'], severity: 'WARNING' },
  { n: 21, status: 200, ms: 300, records: 2.5, codes: ['INVALID_METRICS'], severity: 'WARNING' },
  {
    n: 22,
    status: MISSING,
    ms: MISSING,
    records: MISSING,
    codes: ['INVALID_METRICS', 'MISSING_RECORDS'],
    severity: 'WARNING',
  },
  {
    n: 23,
    status: 200,
    ms: 6000,
    records: 10,
    codes: [],
    severity: null,
    thresholds: { latencyWarningMs: 8000, latencyCriticalMs: 15000 },
  },
  { n: 24, status: 500, ms: 2500, records: 3, codes: ['SERVER_ERROR', 'HIGH_LATENCY'], severity: 'CRITICAL' },
];

const raw = (row: Row) => {
  const item: Record<string, unknown> = { api_name: 'AppointmentAPI' };
  if (row.status !== MISSING) item.status_code = row.status;
  if (row.ms !== MISSING) item.response_time_ms = row.ms;
  if (row.records !== MISSING) item.records_returned = row.records;
  return item;
};

describe('anomaly engine — §7.4 rule table', () => {
  it.each(TABLE)('row $n: status=$status ms=$ms records=$records → $codes', (row) => {
    const outcome = normalizeItem(raw(row), 0, OBSERVED);
    if (outcome.kind !== 'valid') throw new Error('row should be attributable');
    const result = evaluate(outcome.telemetry, { ...DEFAULT_THRESHOLDS, ...row.thresholds });

    expect(result.codes).toEqual(row.codes);
    expect(result.anomalies.map((a) => a.code)).toEqual(row.codes);
    expect(result.severity).toBe(row.severity);
    expect(result.isAnomalous).toBe(row.codes.length > 0);
    expect(result.fingerprint === null).toBe(row.codes.length === 0);
  });

  it('writes the factual details used in the AI prompt', () => {
    const outcome = normalizeItem(raw(TABLE[1] as Row), 0, OBSERVED);
    if (outcome.kind !== 'valid') throw new Error('unreachable');
    expect(evaluate(outcome.telemetry, DEFAULT_THRESHOLDS).anomalies).toEqual([
      { code: 'SERVER_ERROR', severity: 'CRITICAL', detail: 'HTTP 500 server error' },
      { code: 'HIGH_LATENCY', severity: 'CRITICAL', detail: '5500 ms ≥ critical threshold 5000 ms' },
      { code: 'ZERO_RECORDS', severity: 'WARNING', detail: '0 records returned' },
    ]);
  });

  it('is deterministic', () => {
    const outcome = normalizeItem(raw(TABLE[1] as Row), 0, OBSERVED);
    if (outcome.kind !== 'valid') throw new Error('unreachable');
    expect(evaluate(outcome.telemetry, DEFAULT_THRESHOLDS)).toEqual(
      evaluate(outcome.telemetry, DEFAULT_THRESHOLDS),
    );
  });
});

describe('fingerprint — §7.3', () => {
  it('ignores code order', () => {
    expect(fingerprint('AppointmentAPI', ['SERVER_ERROR', 'HIGH_LATENCY', 'ZERO_RECORDS'])).toBe(
      fingerprint('AppointmentAPI', ['ZERO_RECORDS', 'SERVER_ERROR', 'HIGH_LATENCY']),
    );
  });

  it('differs per API', () => {
    expect(fingerprint('AppointmentAPI', ['SERVER_ERROR'])).not.toBe(
      fingerprint('BillingServiceAPI', ['SERVER_ERROR']),
    );
  });

  it('is the same for different severities with the same codes', () => {
    const base = { api_name: 'AppointmentAPI', status_code: 200, records_returned: 10 };
    const warning = normalizeItem({ ...base, response_time_ms: 2500 }, 0, OBSERVED);
    const critical = normalizeItem({ ...base, response_time_ms: 6000 }, 0, OBSERVED);
    if (warning.kind !== 'valid' || critical.kind !== 'valid') throw new Error('unreachable');
    const a = evaluate(warning.telemetry, DEFAULT_THRESHOLDS);
    const b = evaluate(critical.telemetry, DEFAULT_THRESHOLDS);
    expect(a.severity).toBe('WARNING');
    expect(b.severity).toBe('CRITICAL');
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('is sha256(api|sorted codes) in hex', () => {
    expect(fingerprint('X', ['ZERO_RECORDS', 'HIGH_LATENCY'])).toMatch(/^[0-9a-f]{64}$/);
  });
});
