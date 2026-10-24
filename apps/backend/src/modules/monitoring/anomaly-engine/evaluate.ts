import { maxSeverity, type Severity } from '@apimon/shared';
import { fingerprint } from './fingerprint';
import { RULES } from './rules';
import type { Anomaly, Evaluation, NormalizedTelemetry, Thresholds } from './types';

/** Pure and deterministic: no I/O, no clock, no randomness (§7.1). */
export const evaluate = (t: NormalizedTelemetry, th: Thresholds): Evaluation => {
  // RULES is already in ANOMALY_PRIORITY order.
  const anomalies: Anomaly[] = [];
  for (const rule of RULES) {
    const anomaly = rule.evaluate(t, th);
    if (anomaly) anomalies.push(anomaly);
  }

  if (anomalies.length === 0) {
    return { isAnomalous: false, severity: null, anomalies: [], codes: [], fingerprint: null };
  }

  const codes = anomalies.map((anomaly) => anomaly.code);
  const severity = anomalies.reduce<Severity>(
    (max, anomaly) => maxSeverity(max, anomaly.severity),
    'WARNING',
  );
  return { isAnomalous: true, severity, anomalies, codes, fingerprint: fingerprint(t.apiName, codes) };
};
