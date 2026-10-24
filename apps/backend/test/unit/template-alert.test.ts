import { describe, expect, it } from 'vitest';
import {
  buildTemplateAlert,
  templateFieldsFromIssues,
  templateFieldsFromSample,
  type TemplateInput,
} from '../../src/modules/ai/template-alert';
import { PDF_TEMPLATE_MESSAGE } from '../helpers/fixtures';

const input = (overrides: Partial<TemplateInput>): TemplateInput => ({
  apiName: 'AppointmentAPI',
  statusCode: 200,
  responseTimeMs: 300,
  recordsReturned: 10,
  codes: [],
  recordsMissing: false,
  invalidFields: [],
  latencyWarningMs: 2000,
  ...overrides,
});

describe('template alert (§9.6)', () => {
  it('produces exactly the PDF example message', () => {
    const text = buildTemplateAlert(
      input({
        statusCode: 500,
        responseTimeMs: 5500,
        recordsReturned: 0,
        codes: ['SERVER_ERROR', 'HIGH_LATENCY', 'ZERO_RECORDS'],
      }),
    );
    expect(text).toEqual({
      alertMessage: PDF_TEMPLATE_MESSAGE,
      probableCause:
        'Unhandled server exception or failing upstream dependency (database, downstream service).',
      recommendedAction:
        "Check the service's error logs and recent deployments, then verify its database and dependency health.",
    });
  });

  it('uses "responded with" below 400 and the warning threshold for latency', () => {
    expect(buildTemplateAlert(input({ responseTimeMs: 2500, codes: ['HIGH_LATENCY'] })).alertMessage).toBe(
      'AppointmentAPI responded with status 200 and returned 10 records (response time 2500 ms). Response time exceeds the 2000 ms threshold; dependent workflows may be slow or time out.',
    );
  });

  it('handles a single record and a missing record count', () => {
    expect(
      buildTemplateAlert(input({ recordsReturned: 1, codes: ['UNEXPECTED_STATUS'], statusCode: 302 }))
        .alertMessage,
    ).toMatch(/^AppointmentAPI responded with status 302 and returned 1 record \(response time 300 ms\)\./);
    expect(
      buildTemplateAlert(
        input({
          recordsReturned: null,
          codes: ['MISSING_RECORDS'],
          recordsMissing: true,
        }),
      ).alertMessage,
    ).toBe(
      'AppointmentAPI responded with status 200 and did not report a record count (response time 300 ms). The response omitted the record count; possible contract change.',
    );
  });

  it('describes invalid telemetry and lists the invalid fields', () => {
    expect(
      buildTemplateAlert(
        input({
          statusCode: null,
          responseTimeMs: null,
          recordsReturned: null,
          codes: ['INVALID_METRICS', 'MISSING_RECORDS'],
          ...templateFieldsFromIssues([
            { field: 'status_code', problem: 'missing' },
            { field: 'response_time_ms', problem: 'missing' },
            { field: 'records_returned', problem: 'missing' },
          ]),
        }),
      ).alertMessage,
    ).toBe(
      "AppointmentAPI reported invalid telemetry and did not report a record count. Invalid fields: status_code, response_time_ms. Telemetry is malformed; check the integration's instrumentation.",
    );
  });

  it('picks the impact sentence from the highest-priority code', () => {
    const text = buildTemplateAlert(
      input({ statusCode: 401, recordsReturned: 0, codes: ['ZERO_RECORDS', 'AUTH_FAILURE'] }),
    );
    expect(text.alertMessage).toBe(
      'AppointmentAPI failed with status 401 and returned 0 records (response time 300 ms). Credentials may be expired or revoked; requests are being rejected.',
    );
  });

  it('names the invalid field when rebuilt from a stored sample (AI fallback path)', () => {
    const sample = { statusCode: 200, responseTimeMs: null, recordsReturned: 12 };
    expect(templateFieldsFromSample(sample, ['INVALID_METRICS'])).toEqual({
      recordsMissing: false,
      invalidFields: ['response_time_ms'],
    });
    expect(
      buildTemplateAlert(
        input({
          ...sample,
          codes: ['INVALID_METRICS'],
          ...templateFieldsFromSample(sample, ['INVALID_METRICS']),
        }),
      ).alertMessage,
    ).toBe(
      "AppointmentAPI responded with status 200 and returned 12 records. Invalid fields: response_time_ms. Telemetry is malformed; check the integration's instrumentation.",
    );
  });

  it('never prints an empty field list', () => {
    expect(buildTemplateAlert(input({ codes: ['INVALID_METRICS'] })).alertMessage).not.toContain(
      'Invalid fields',
    );
  });
});
