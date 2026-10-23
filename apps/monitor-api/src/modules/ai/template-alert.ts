import { ANOMALY_PRIORITY, type AnomalyCode, type FieldIssue } from '@apimon/shared';

export interface AlertText {
  alertMessage: string;
  probableCause: string;
  recommendedAction: string;
}

export interface TemplateInput {
  apiName: string;
  statusCode: number | null;
  responseTimeMs: number | null;
  recordsReturned: number | null;
  codes: readonly AnomalyCode[];
  issues: readonly FieldIssue[];
  latencyWarningMs: number;
}

const IMPACT: Record<AnomalyCode, { impact: (warningMs: number) => string; cause: string; action: string }> =
  {
    SERVER_ERROR: {
      impact: () => 'Possible outage or data issue.',
      cause: 'Unhandled server exception or failing upstream dependency (database, downstream service).',
      action:
        "Check the service's error logs and recent deployments, then verify its database and dependency health.",
    },
    AUTH_FAILURE: {
      impact: () => 'Credentials may be expired or revoked; requests are being rejected.',
      cause: 'Expired, rotated or revoked API credentials or insufficient permissions.',
      action: "Verify the integration's credentials and token expiry, and rotate them if needed.",
    },
    INVALID_METRICS: {
      impact: () => "Telemetry is malformed; check the integration's instrumentation.",
      cause: 'Instrumentation bug or an unannounced change in the response contract.',
      action: 'Compare the raw response with the expected contract and fix the telemetry emitter.',
    },
    CLIENT_ERROR: {
      impact: () => 'Requests are being rejected (rate limiting or a contract/configuration change).',
      cause: 'Rate limit exceeded, invalid request parameters, or a changed endpoint contract.',
      action: 'Check rate-limit headers and recent request changes; back off or fix the request.',
    },
    HIGH_LATENCY: {
      impact: (warningMs) =>
        `Response time exceeds the ${warningMs} ms threshold; dependent workflows may be slow or time out.`,
      cause: 'Resource saturation, slow queries, or a degraded upstream dependency.',
      action:
        'Check latency dashboards, slow-query logs and upstream status; scale or fail over if it persists.',
    },
    MISSING_RECORDS: {
      impact: () => 'The response omitted the record count; possible contract change.',
      cause: 'Response schema change or partial response.',
      action: 'Verify the response schema against the integration contract.',
    },
    ZERO_RECORDS: {
      impact: () => 'The request returned no data; possible data sync or query issue.',
      cause: 'Empty upstream dataset, failed sync job, or an overly narrow query.',
      action: 'Check the upstream data source and the last successful sync.',
    },
    UNEXPECTED_STATUS: {
      impact: () => 'Unexpected status for a data request; verify redirects and endpoint configuration.',
      cause: 'Endpoint moved or misconfigured client.',
      action: 'Verify the configured endpoint URL and redirect handling.',
    },
  };

/**
 * Deterministic alert text (§9.6) — written for every new alert and the final AI fallback.
 * It only ever uses numbers from the trigger sample, so it can never contradict the metrics.
 */
export const buildTemplateAlert = (input: TemplateInput): AlertText => {
  const { apiName, statusCode, responseTimeMs, recordsReturned } = input;

  let headline =
    statusCode === null
      ? `${apiName} reported invalid telemetry`
      : statusCode >= 400
        ? `${apiName} failed with status ${statusCode}`
        : `${apiName} responded with status ${statusCode}`;

  const recordsMissing = input.issues.some((i) => i.field === 'records_returned' && i.problem === 'missing');
  if (recordsReturned !== null) {
    headline += ` and returned ${recordsReturned} ${recordsReturned === 1 ? 'record' : 'records'}`;
  } else if (recordsMissing) {
    headline += ' and did not report a record count';
  }
  if (responseTimeMs !== null) headline += ` (response time ${responseTimeMs} ms)`;
  headline += '.';

  if (input.codes.includes('INVALID_METRICS')) {
    const invalid = input.issues
      .filter((i) => !(i.field === 'records_returned' && i.problem === 'missing'))
      .map((i) => i.field);
    headline += ` Invalid fields: ${[...new Set(invalid)].join(', ')}.`;
  }

  const primary = ANOMALY_PRIORITY.find((code) => input.codes.includes(code)) ?? 'SERVER_ERROR';
  const entry = IMPACT[primary];
  return {
    alertMessage: `${headline} ${entry.impact(input.latencyWarningMs)}`,
    probableCause: entry.cause,
    recommendedAction: entry.action,
  };
};
