import type { AlertRow } from '../../infrastructure/database/schema';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const metric = (statusCode: number | null, responseTimeMs: number | null, records: number | null) =>
  `status ${statusCode ?? 'n/a'}, ${responseTimeMs === null ? 'n/a' : `${responseTimeMs} ms`}, ${records ?? 'n/a'} records`;

export interface AlertEmail {
  subject: string;
  text: string;
  html: string;
}

/** §13.2: final alert text, metrics, occurrences, timestamps and a link. Every value is HTML-escaped. */
export const buildAlertEmail = (
  alert: AlertRow,
  reason: 'NEW' | 'ESCALATED',
  publicWebUrl: string,
): AlertEmail => {
  const codes = alert.anomalyTypes.join(', ');
  const subject = `[${alert.severity}] ${alert.apiName} — ${codes}${reason === 'ESCALATED' ? ' (escalated)' : ''}`;
  const link = `${publicWebUrl.replace(/\/$/, '')}/alerts/${alert.id}`;
  const rows: [string, string][] = [
    [
      'Severity',
      reason === 'ESCALATED' && alert.previousSeverity
        ? `${alert.previousSeverity} → ${alert.severity}`
        : alert.severity,
    ],
    ['Anomalies', codes],
    ['Trigger sample', metric(alert.statusCode, alert.responseTimeMs, alert.recordsReturned)],
    ['Latest sample', metric(alert.lastStatusCode, alert.lastResponseTimeMs, alert.lastRecordsReturned)],
    ['Peak response time', alert.peakResponseTimeMs === null ? 'n/a' : `${alert.peakResponseTimeMs} ms`],
    ['Occurrences', String(alert.occurrenceCount)],
    ['First seen', alert.firstSeenAt.toISOString()],
    ['Last seen', alert.lastSeenAt.toISOString()],
    ['Text source', alert.aiProvider ?? 'template'],
  ];

  const text = [
    subject,
    '',
    alert.alertMessage,
    '',
    `Probable cause: ${alert.probableCause}`,
    `Recommended action: ${alert.recommendedAction}`,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    `Open: ${link}`,
  ].join('\n');

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1f2933; max-width: 640px">
<h2 style="margin: 0 0 12px">${escapeHtml(subject)}</h2>
<p style="font-size: 15px">${escapeHtml(alert.alertMessage)}</p>
<p><strong>Probable cause:</strong> ${escapeHtml(alert.probableCause)}<br>
<strong>Recommended action:</strong> ${escapeHtml(alert.recommendedAction)}</p>
<table cellpadding="6" style="border-collapse: collapse; font-size: 14px">
${rows.map(([label, value]) => `<tr><td style="color: #52606d">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join('\n')}
</table>
<p><a href="${escapeHtml(link)}">Open the alert</a></p>
</body></html>`;

  return { subject, text, html };
};
