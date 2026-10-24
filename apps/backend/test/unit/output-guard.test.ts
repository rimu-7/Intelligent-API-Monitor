import { describe, expect, it } from 'vitest';
import { buildPromptInput } from '../../src/modules/ai/alert-prompt';
import { extractJsonObject, guardOutput } from '../../src/modules/ai/output-guard';
import { DEFAULT_THRESHOLDS } from '../helpers/fixtures';

const input = buildPromptInput(
  {
    apiName: 'AppointmentAPI',
    statusCode: 500,
    responseTimeMs: 5500,
    recordsReturned: 0,
    severity: 'CRITICAL',
    anomalyTypes: ['SERVER_ERROR', 'HIGH_LATENCY', 'ZERO_RECORDS'],
    occurrenceCount: 1,
  },
  DEFAULT_THRESHOLDS,
  'new_incident',
);

const reply = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    alert_message:
      'AppointmentAPI returned HTTP 500 after 5500 ms with 0 records; scheduling is likely down.',
    probable_cause: 'Likely an unhandled exception in the booking service.',
    recommended_action: 'Check the error logs and the last deployment.',
    ...overrides,
  });

describe('output guard (§9.5)', () => {
  it('accepts a valid, grounded output', () => {
    const result = guardOutput(reply(), input);
    expect(result).toEqual({
      ok: true,
      text: {
        alertMessage:
          'AppointmentAPI returned HTTP 500 after 5500 ms with 0 records; scheduling is likely down.',
        probableCause: 'Likely an unhandled exception in the booking service.',
        recommendedAction: 'Check the error logs and the last deployment.',
      },
    });
  });

  it('accepts fenced JSON with surrounding prose', () => {
    expect(guardOutput(`Here you go:\n\`\`\`json\n${reply()}\n\`\`\`\nThanks!`, input).ok).toBe(true);
  });

  it('rejects an invented number', () => {
    expect(
      guardOutput(reply({ alert_message: 'AppointmentAPI failed for 37% of requests (HTTP 500).' }), input),
    ).toMatchObject({
      ok: false,
      reason: 'UNGROUNDED_NUMBER',
      detail: '37',
    });
  });

  it('allows latency in seconds and thousands separators', () => {
    expect(
      guardOutput(
        reply({ alert_message: 'AppointmentAPI took 5.5 s (5,500 ms) and returned HTTP 500.' }),
        input,
      ).ok,
    ).toBe(true);
    expect(
      guardOutput(
        reply({ alert_message: 'AppointmentAPI is above the 5 s critical threshold with HTTP 500.' }),
        input,
      ).ok,
    ).toBe(true);
  });

  it('rejects a missing key', () => {
    const { recommended_action: _omit, ...rest } = JSON.parse(reply()) as Record<string, unknown>;
    expect(guardOutput(JSON.stringify(rest), input)).toMatchObject({ ok: false, reason: 'INVALID_SHAPE' });
  });

  it('rejects an extra key', () => {
    expect(guardOutput(reply({ severity: 'LOW' }), input)).toMatchObject({
      ok: false,
      reason: 'INVALID_SHAPE',
    });
  });

  it('rejects text without the exact api_name', () => {
    expect(
      guardOutput(reply({ alert_message: 'The appointment API returned HTTP 500 after 5500 ms.' }), input),
    ).toMatchObject({
      ok: false,
      reason: 'MISSING_API_NAME',
    });
  });

  it('rejects non-JSON and out-of-range lengths', () => {
    expect(guardOutput('I cannot help with that.', input)).toMatchObject({ ok: false, reason: 'NOT_JSON' });
    expect(guardOutput('{"alert_message": ', input)).toMatchObject({ ok: false, reason: 'NOT_JSON' });
    expect(guardOutput(reply({ alert_message: 'AppointmentAPI down' }), input)).toMatchObject({
      ok: false,
      reason: 'INVALID_SHAPE',
    });
    expect(guardOutput(reply({ alert_message: `AppointmentAPI ${'x'.repeat(300)}` }), input)).toMatchObject({
      ok: false,
      reason: 'INVALID_SHAPE',
    });
  });

  it('strips markdown and collapses whitespace', () => {
    const result = guardOutput(reply({ probable_cause: '# **Likely**   a `pool`\n exhaustion.' }), input);
    expect(result.ok && result.text.probableCause).toBe('Likely a pool exhaustion.');
  });

  it('extracts the first balanced object, respecting braces inside strings', () => {
    expect(extractJsonObject('x {"a":"}{","b":{"c":1}} trailing {"d":2}')).toBe('{"a":"}{","b":{"c":1}}');
    expect(extractJsonObject('no json')).toBeNull();
  });
});
