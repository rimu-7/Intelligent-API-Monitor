import { pino } from 'pino';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { ThresholdsService, type StoredThresholds } from '../../src/modules/monitoring/thresholds.service';

const failingRedis = {
  mget: () => Promise.reject(new Error('redis down')),
  pipeline: () => ({ set: () => undefined, exec: () => Promise.reject(new Error('redis down')) }),
} as unknown as Redis;

const make = (rows: StoredThresholds[]) =>
  new ThresholdsService(
    { findThresholds: (names) => Promise.resolve(rows.filter((row) => names.includes(row.name))) },
    failingRedis,
    { latencyWarningMs: 2000, latencyCriticalMs: 5000 },
    pino({ level: 'silent' }),
  );

describe('ThresholdsService', () => {
  it('merges per-API overrides over env defaults and falls back to the DB when Redis fails', async () => {
    const service = make([
      { name: 'Slow', latencyWarningMs: 8000, latencyCriticalMs: 15000, expectsRecords: true },
      { name: 'NoRecords', latencyWarningMs: null, latencyCriticalMs: null, expectsRecords: false },
    ]);
    const result = await service.getThresholds(['Slow', 'NoRecords', 'Unknown', 'Slow']);
    expect(result.get('Slow')).toEqual({
      latencyWarningMs: 8000,
      latencyCriticalMs: 15000,
      expectsRecords: true,
    });
    expect(result.get('NoRecords')).toEqual({
      latencyWarningMs: 2000,
      latencyCriticalMs: 5000,
      expectsRecords: false,
    });
    expect(result.get('Unknown')).toEqual({
      latencyWarningMs: 2000,
      latencyCriticalMs: 5000,
      expectsRecords: true,
    });
    expect(result.size).toBe(3);
  });
});
