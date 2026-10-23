import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FieldIssue } from '@apimon/shared';
import type { NormalizedTelemetry, Thresholds } from '../../src/modules/monitoring/anomaly-engine/types';

export const SAMPLES_DIR = path.resolve(import.meta.dirname, '../../../../data/samples');
export const readSample = (file: string): unknown =>
  JSON.parse(readFileSync(path.join(SAMPLES_DIR, file), 'utf8'));

export const PDF_EXAMPLE = [
  { api_name: 'PatientDataAPI', response_time_ms: 1200, status_code: 200, records_returned: 50 },
  { api_name: 'AppointmentAPI', response_time_ms: 5500, status_code: 500, records_returned: 0 },
];

export const PDF_TEMPLATE_MESSAGE =
  'AppointmentAPI failed with status 500 and returned 0 records (response time 5500 ms). Possible outage or data issue.';

export const DEFAULT_THRESHOLDS: Thresholds = {
  latencyWarningMs: 2000,
  latencyCriticalMs: 5000,
  expectsRecords: true,
};

export const OBSERVED = new Date('2026-10-23T10:00:00.000Z');

export const telemetry = (overrides: Partial<NormalizedTelemetry> = {}): NormalizedTelemetry => ({
  index: 0,
  apiName: 'AppointmentAPI',
  statusCode: 200,
  responseTimeMs: 100,
  recordsReturned: 10,
  observedAt: OBSERVED,
  issues: [] as FieldIssue[],
  ...overrides,
});
