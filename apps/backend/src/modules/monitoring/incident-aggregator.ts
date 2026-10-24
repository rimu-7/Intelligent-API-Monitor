import { maxSeverity, severityRank, type AnomalyCode, type Severity } from '@apimon/shared';
import type { Anomaly, Evaluation, NormalizedTelemetry, Thresholds } from './anomaly-engine/types';

export interface EvaluatedTelemetry {
  telemetry: NormalizedTelemetry;
  evaluation: Evaluation;
  thresholds: Thresholds;
}

/** All anomalous samples of one incident within a request (§8.1 step 5). */
export interface IncidentGroup {
  fingerprint: string;
  apiName: string;
  codes: AnomalyCode[];
  severity: Severity;
  count: number;
  /** Earliest-observed sample whose own severity equals the group max — the alert text describes it. */
  trigger: NormalizedTelemetry;
  triggerAnomalies: Anomaly[];
  thresholds: Thresholds;
  /** Latest-observed sample. */
  latest: NormalizedTelemetry;
  peakResponseTimeMs: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const earlier = (a: NormalizedTelemetry, b: NormalizedTelemetry) =>
  a.observedAt.getTime() < b.observedAt.getTime() ||
  (a.observedAt.getTime() === b.observedAt.getTime() && a.index < b.index);

/**
 * Groups anomalous evaluations by fingerprint so one INSERT never touches the same conflict
 * key twice (§21.4). Groups are sorted by fingerprint for a consistent lock order (§21.6). Pure.
 */
export const aggregateIncidents = (items: readonly EvaluatedTelemetry[]): IncidentGroup[] => {
  const groups = new Map<string, EvaluatedTelemetry[]>();
  for (const item of items) {
    const key = item.evaluation.fingerprint;
    if (!item.evaluation.isAnomalous || key === null) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  const result: IncidentGroup[] = [];
  for (const [fingerprint, members] of groups) {
    const severity = members.reduce<Severity>(
      (max, member) => maxSeverity(max, member.evaluation.severity ?? 'WARNING'),
      'WARNING',
    );

    let trigger: EvaluatedTelemetry | undefined;
    let latest = members[0];
    let first = members[0];
    let peak: number | null = null;
    for (const member of members) {
      const t = member.telemetry;
      const own = member.evaluation.severity ?? 'WARNING';
      if (severityRank(own) === severityRank(severity) && (!trigger || earlier(t, trigger.telemetry)))
        trigger = member;
      if (latest && earlier(latest.telemetry, t)) latest = member;
      if (first && earlier(t, first.telemetry)) first = member;
      if (t.responseTimeMs !== null)
        peak = peak === null ? t.responseTimeMs : Math.max(peak, t.responseTimeMs);
    }
    // A non-empty group always has a member at the max severity.
    if (!trigger || !latest || !first) continue;

    result.push({
      fingerprint,
      apiName: trigger.telemetry.apiName,
      codes: trigger.evaluation.codes,
      severity,
      count: members.length,
      trigger: trigger.telemetry,
      triggerAnomalies: trigger.evaluation.anomalies,
      thresholds: trigger.thresholds,
      latest: latest.telemetry,
      peakResponseTimeMs: peak,
      firstSeenAt: first.telemetry.observedAt,
      lastSeenAt: latest.telemetry.observedAt,
    });
  }

  return result.sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0));
};
