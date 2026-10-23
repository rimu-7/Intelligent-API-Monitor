import { describe, expect, it } from 'vitest';
import type { AlertRow } from '../../src/infrastructure/database/schema';
import { buildAlertEmail } from '../../src/modules/notifications/email-templates';

const alert = {
  id: '11111111-2222-4333-8444-555555555555',
  apiName: 'AppointmentAPI',
  severity: 'CRITICAL',
  previousSeverity: 'WARNING',
  anomalyTypes: ['SERVER_ERROR', 'HIGH_LATENCY'],
  alertMessage: 'AppointmentAPI <script>alert(1)</script> & "quotes"',
  probableCause: "It's <b>bad</b>",
  recommendedAction: 'Check <logs>',
  statusCode: 500,
  responseTimeMs: 2500,
  recordsReturned: 3,
  lastStatusCode: 503,
  lastResponseTimeMs: 2600,
  lastRecordsReturned: null,
  peakResponseTimeMs: 2600,
  occurrenceCount: 4,
  aiProvider: 'template',
  firstSeenAt: new Date('2026-10-23T10:00:00Z'),
  lastSeenAt: new Date('2026-10-23T10:05:00Z'),
} as unknown as AlertRow;

describe('alert email', () => {
  it('escapes every interpolated value in HTML', () => {
    const { html } = buildAlertEmail(alert, 'NEW', 'http://localhost:3000');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;');
    expect(html).toContain('It&#39;s &lt;b&gt;bad&lt;/b&gt;');
  });

  it('includes metrics, occurrences, timestamps and the link', () => {
    const { subject, text } = buildAlertEmail(alert, 'ESCALATED', 'https://monitor.example.com/');
    expect(subject).toBe('[CRITICAL] AppointmentAPI — SERVER_ERROR, HIGH_LATENCY (escalated)');
    expect(text).toContain('Severity: WARNING → CRITICAL');
    expect(text).toContain('Trigger sample: status 500, 2500 ms, 3 records');
    expect(text).toContain('Latest sample: status 503, 2600 ms, n/a records');
    expect(text).toContain('Occurrences: 4');
    expect(text).toContain('First seen: 2026-10-23T10:00:00.000Z');
    expect(text).toContain('Open: https://monitor.example.com/alerts/11111111-2222-4333-8444-555555555555');
  });
});
