import { pino } from 'pino';
import supertest from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimulatorApp } from '../src/app';
import { API_NAMES } from '../src/catalog/api-profiles';
import { MonitorApiClient, PushError } from '../src/clients/monitor-api.client';
import { parseSimulatorEnv } from '../src/config/env';
import { mulberry32 } from '../src/generator/prng';
import { TelemetryGenerator, type TelemetryItem } from '../src/generator/telemetry-generator';
import { findScenario, SCENARIOS } from '../src/scenarios/scenarios';
import { StreamController } from '../src/streaming/stream-controller';

const logger = pino({ level: 'silent' });
const KEY = 'test-internal-key-0123456789abcdef0123456789ab';

describe('prng and generator', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, a);
    expect(seqA).toEqual(Array.from({ length: 5 }, b));
    expect(seqA.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(Array.from({ length: 5 }, mulberry32(43))).not.toEqual(seqA);
  });

  it('reproduces the same telemetry for the same seed', () => {
    expect(new TelemetryGenerator(7).batch(50)).toEqual(new TelemetryGenerator(7).batch(50));
  });

  it('emits exactly the PDF item shape for catalog APIs', () => {
    for (const item of new TelemetryGenerator(42).batch(500)) {
      expect(API_NAMES).toContain(item.api_name);
      expect(
        Object.keys(item).every((key) =>
          ['api_name', 'response_time_ms', 'status_code', 'records_returned'].includes(key),
        ),
      ).toBe(true);
    }
  });

  it('produces only healthy samples for the healthy batch', () => {
    for (const item of new TelemetryGenerator(1).healthy(100)) {
      expect(item.status_code).toBe(200);
      expect(item.response_time_ms).toBeLessThan(2000);
      expect(item.records_returned).toBeGreaterThan(0);
    }
  });
});

describe('scenarios', () => {
  const g = new TelemetryGenerator(42);

  it('has every scenario from §14', () => {
    expect(SCENARIOS.map((s) => s.name)).toEqual([
      'pdf-example',
      'healthy-batch',
      'high-latency',
      'server-error',
      'zero-records',
      'missing-records',
      'invalid-metrics',
      'auth-failure',
      'rate-limited',
      'outage-burst',
      'escalation',
      'mixed-batch',
    ]);
  });

  it('pdf-example is the exact assignment array', () => {
    expect(findScenario('pdf-example')?.batches(g)).toEqual([
      [
        { api_name: 'PatientDataAPI', response_time_ms: 1200, status_code: 200, records_returned: 50 },
        { api_name: 'AppointmentAPI', response_time_ms: 5500, status_code: 500, records_returned: 0 },
      ],
    ]);
  });

  it('outage-burst is 25 AppointmentAPI 503s with one symptom set', () => {
    const [batch] = findScenario('outage-burst')?.batches(g) ?? [];
    expect(batch).toHaveLength(25);
    expect(
      batch?.every(
        (i) => i.api_name === 'AppointmentAPI' && i.status_code === 503 && Number(i.response_time_ms) < 2000,
      ),
    ).toBe(true);
  });

  it('escalation pushes WARNING then CRITICAL latency', () => {
    const batches = findScenario('escalation')?.batches(g) ?? [];
    expect(batches.map((b) => b[0]?.response_time_ms)).toEqual([2500, 6000]);
  });

  it('mixed-batch has 200 items', () => {
    expect(findScenario('mixed-batch')?.batches(g)[0]).toHaveLength(200);
  });
});

describe('push client', () => {
  it('retries with the same Idempotency-Key and wraps the batch with a simulator source', async () => {
    const seen: { key: string | null; body: unknown }[] = [];
    let calls = 0;
    const fetchFn = ((_url: string, init: RequestInit) => {
      calls += 1;
      seen.push({
        key: new Headers(init.headers).get('idempotency-key'),
        body: JSON.parse(init.body as string),
      });
      if (calls < 3) return Promise.resolve(new Response('{}', { status: 503 }));
      return Promise.resolve(
        Response.json({
          success: true,
          data: { run_id: 'r1', received: 1, anomalous: 1, alerts_created: 1, alerts_updated: 0 },
        }),
      );
    }) as typeof fetch;
    const client = new MonitorApiClient('http://api', 'ingest', logger, fetchFn, [1, 1, 1]);
    const result = await client.push(
      [{ api_name: 'A', response_time_ms: 1, status_code: 200 }],
      'outage-burst',
    );
    expect(result).toMatchObject({ attempts: 3, run_id: 'r1', alerts_created: 1 });
    expect(new Set(seen.map((s) => s.key)).size).toBe(1);
    expect(seen[0]?.body).toMatchObject({ source: 'simulator:outage-burst' });
  });

  it('does not retry client errors', async () => {
    let calls = 0;
    const fetchFn = (() => {
      calls += 1;
      return Promise.resolve(new Response('{}', { status: 401 }));
    }) as typeof fetch;
    const client = new MonitorApiClient('http://api', 'bad', logger, fetchFn, [1, 1, 1]);
    await expect(client.push([], 'x')).rejects.toBeInstanceOf(PushError);
    expect(calls).toBe(1);
  });

  it('gives up after 3 retries on network errors', async () => {
    let calls = 0;
    const fetchFn = (() => {
      calls += 1;
      return Promise.reject(new TypeError('fetch failed'));
    }) as typeof fetch;
    await expect(
      new MonitorApiClient('http://api', 'k', logger, fetchFn, [1, 1, 1]).push([], 'x'),
    ).rejects.toThrow('fetch failed');
    expect(calls).toBe(4);
  });
});

describe('stream controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const pushes: TelemetryItem[][] = [];
  const okClient = {
    push: (items: TelemetryItem[]) => {
      pushes.push(items);
      return Promise.resolve({} as never);
    },
  };

  it('pushes batches on a jittered timeout chain and auto-stops at the max duration', async () => {
    pushes.length = 0;
    const stream = new StreamController(new TelemetryGenerator(1), okClient, 10_000, logger, () => 0.5);
    stream.start({ intervalMs: 1_000, batchSize: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(pushes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(pushes).toHaveLength(4);
    expect(pushes.every((batch) => batch.length === 3)).toBe(true);

    await vi.advanceTimersByTimeAsync(20_000);
    const status = stream.getStatus();
    expect(status.streaming).toBe(false);
    expect(status.stopped_reason).toBe('max_duration_reached');
    const sent = pushes.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pushes).toHaveLength(sent);
  });

  it('never overlaps pushes (single flight) and backs off on failure up to 30 s', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    const slowFailing = {
      push: async () => {
        calls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        inFlight -= 1;
        throw new Error('api down');
      },
    };
    const stream = new StreamController(new TelemetryGenerator(1), slowFailing, 600_000, logger, () => 0.5);
    stream.start({ intervalMs: 500, batchSize: 1 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(maxInFlight).toBe(1);
    expect(stream.getStatus().consecutive_failures).toBe(calls);
    // With exponential backoff capped at 30 s, two minutes allow only a handful of attempts.
    expect(calls).toBeLessThan(10);
    stream.stop();
  });
});

describe('http app', () => {
  const generator = new TelemetryGenerator(42);
  const client = {
    push: (items: TelemetryItem[]) =>
      Promise.resolve({
        status: 200,
        run_id: 'r',
        received: items.length,
        anomalous: 0,
        alerts_created: 0,
        alerts_updated: 0,
        idempotency_key: 'k',
        attempts: 1,
      }),
  };
  const app = createSimulatorApp({
    generator,
    client,
    stream: new StreamController(generator, client, 60_000, logger),
    internalKey: KEY,
    logger,
  });

  it('serves health and public telemetry', async () => {
    const health = await supertest(app).get('/health');
    expect(health.body).toMatchObject({ status: 'ok', streaming: false });
    const telemetry = await supertest(app).get('/api/telemetry?count=5');
    expect(telemetry.body.data).toHaveLength(5);
    expect((await supertest(app).get('/api/telemetry?count=501')).status).toBe(400);
  });

  it('requires the internal key for control endpoints', async () => {
    expect((await supertest(app).get('/api/scenarios')).status).toBe(401);
    expect((await supertest(app).get('/api/scenarios').set('x-internal-key', 'wrong')).status).toBe(401);
    expect((await supertest(app).post('/api/stream/start').send({})).status).toBe(401);
    const list = await supertest(app).get('/api/scenarios').set('x-internal-key', KEY);
    expect(list.body.data).toHaveLength(12);
  });

  it('runs scenarios and validates stream options', async () => {
    const run = await supertest(app).post('/api/scenarios/escalation').set('x-internal-key', KEY);
    expect(run.body.data.batches).toHaveLength(2);
    expect((await supertest(app).post('/api/scenarios/nope').set('x-internal-key', KEY)).status).toBe(404);
    expect(
      (await supertest(app).post('/api/stream/start').set('x-internal-key', KEY).send({ interval_ms: 100 }))
        .status,
    ).toBe(400);
    const started = await supertest(app)
      .post('/api/stream/start')
      .set('x-internal-key', KEY)
      .send({ interval_ms: 60_000, batch_size: 1 });
    expect(started.body.data.streaming).toBe(true);
    const stopped = await supertest(app).post('/api/stream/stop').set('x-internal-key', KEY);
    expect(stopped.body.data.streaming).toBe(false);
  });
});

describe('env', () => {
  const base = { INGEST_API_KEY: 'k'.repeat(40), INTERNAL_SERVICE_KEY: 'i'.repeat(40) };
  it('parses defaults and refuses dev-only secrets in production', () => {
    expect(parseSimulatorEnv(base)).toMatchObject({
      LISTEN_PORT: 4400,
      SIMULATOR_SEED: 42,
      STREAM_MAX_DURATION_MS: 600_000,
    });
    expect(() =>
      parseSimulatorEnv({ ...base, APP_ENV: 'production', INGEST_API_KEY: `dev-only-${'x'.repeat(40)}` }),
    ).toThrow(/dev-only/);
    expect(() => parseSimulatorEnv({ ...base, INTERNAL_SERVICE_KEY: 'short' })).toThrow(/at least 32/);
  });
});
