import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/modules/monitoring/anomaly-engine/evaluate';
import {
  aggregateIncidents,
  type EvaluatedTelemetry,
} from '../../src/modules/monitoring/incident-aggregator';
import { DEFAULT_THRESHOLDS, telemetry } from '../helpers/fixtures';

const at = (iso: string) => new Date(iso);
const item = (overrides: Parameters<typeof telemetry>[0]): EvaluatedTelemetry => {
  const t = telemetry(overrides);
  return { telemetry: t, evaluation: evaluate(t, DEFAULT_THRESHOLDS), thresholds: DEFAULT_THRESHOLDS };
};

describe('aggregateIncidents', () => {
  it('ignores healthy items', () => {
    expect(aggregateIncidents([item({ statusCode: 200, responseTimeMs: 100 })])).toEqual([]);
  });

  it('collapses identical anomalies into one group with a count', () => {
    const items = Array.from({ length: 25 }, (_, index) =>
      item({ index, statusCode: 503, responseTimeMs: 800 + index, recordsReturned: 12 }),
    );
    const [group, ...rest] = aggregateIncidents(items);
    expect(rest).toEqual([]);
    expect(group).toMatchObject({
      count: 25,
      severity: 'CRITICAL',
      codes: ['SERVER_ERROR'],
      peakResponseTimeMs: 824,
    });
    expect(group?.trigger.index).toBe(0);
    expect(group?.latest.index).toBe(24);
  });

  it('separates different symptom sets and APIs, sorted by fingerprint', () => {
    const groups = aggregateIncidents([
      item({ apiName: 'A', statusCode: 500 }),
      item({ apiName: 'A', statusCode: 404, recordsReturned: 0 }),
      item({ apiName: 'B', statusCode: 500 }),
    ]);
    expect(groups).toHaveLength(3);
    const fingerprints = groups.map((g) => g.fingerprint);
    expect(fingerprints).toEqual([...fingerprints].sort());
  });

  it('picks the earliest sample at the group max severity as the trigger', () => {
    const groups = aggregateIncidents([
      item({ index: 0, responseTimeMs: 2500, observedAt: at('2026-10-23T10:00:00Z') }),
      item({ index: 1, responseTimeMs: 7000, observedAt: at('2026-10-23T10:02:00Z') }),
      item({ index: 2, responseTimeMs: 6000, observedAt: at('2026-10-23T10:01:00Z') }),
      item({ index: 3, responseTimeMs: 3000, observedAt: at('2026-10-23T10:03:00Z') }),
    ]);
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group?.severity).toBe('CRITICAL');
    expect(group?.trigger.index).toBe(2);
    expect(group?.latest.index).toBe(3);
    expect(group?.peakResponseTimeMs).toBe(7000);
    expect(group?.firstSeenAt.toISOString()).toBe('2026-10-23T10:00:00.000Z');
    expect(group?.lastSeenAt.toISOString()).toBe('2026-10-23T10:03:00.000Z');
    expect(group?.triggerAnomalies[0]?.detail).toBe('6000 ms ≥ critical threshold 5000 ms');
  });
});
