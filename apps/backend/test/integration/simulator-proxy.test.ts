import { pino } from 'pino';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SimulatorClient } from '../../src/modules/simulator/simulator.client';
import { createUser, login } from '../helpers/auth';
import { createTestContext, type TestContext } from '../helpers/test-app';

/** In-memory stand-in for the simulator's HTTP control API. */
class FakeSimulator extends SimulatorClient {
  calls: string[] = [];
  constructor() {
    super('http://unused', 'key', pino({ level: 'silent' }));
  }
  override listScenarios() {
    this.calls.push('list');
    return Promise.resolve([{ name: 'outage-burst', description: '25 × 503' }]);
  }
  override runScenario(name: string) {
    this.calls.push(`run:${name}`);
    return Promise.resolve({ scenario: name, batches: [{ items: 25 }] });
  }
  override startStream(options: { interval_ms: number; batch_size: number }) {
    this.calls.push(`start:${options.interval_ms}:${options.batch_size}`);
    return Promise.resolve({ streaming: true });
  }
  override stopStream() {
    this.calls.push('stop');
    return Promise.resolve({ streaming: false });
  }
  override streamStatus() {
    return Promise.resolve({ streaming: false });
  }
  override fetchTelemetry(count: number) {
    this.calls.push(`fetch:${count}`);
    return Promise.resolve(
      Array.from({ length: count }, (_, i) => ({
        api_name: 'LabResultsAPI',
        response_time_ms: 100 + i,
        status_code: 200,
        records_returned: 3,
      })),
    );
  }
}

const fake = new FakeSimulator();
let ctx: TestContext;
let unreachable: TestContext;

beforeAll(async () => {
  ctx = await createTestContext({}, { simulator: fake });
  unreachable = await createTestContext();
});
afterAll(async () => {
  await Promise.all([ctx.close(), unreachable.close()]);
});

describe('simulator proxy (§11.2)', () => {
  it('requires simulator:control', async () => {
    expect((await supertest(ctx.app).get('/api/v1/simulator/scenarios')).status).toBe(401);
    const manager = await login(ctx, await createUser(ctx, 'MANAGER'));
    for (const [method, path] of [
      ['get', '/api/v1/simulator/scenarios'],
      ['post', '/api/v1/simulator/scenarios/outage-burst'],
      ['post', '/api/v1/simulator/stream/start'],
      ['post', '/api/v1/simulator/stream/stop'],
      ['get', '/api/v1/simulator/stream/status'],
      ['post', '/api/v1/monitor/fetch-live'],
    ] as const) {
      expect((await supertest(ctx.app)[method](path).set(manager.auth).send({})).status).toBe(403);
    }
  });

  it('proxies scenarios and stream control for admins, validating input first', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    expect(
      (await supertest(ctx.app).get('/api/v1/simulator/scenarios').set(admin.auth)).body.data,
    ).toHaveLength(1);
    expect(
      (await supertest(ctx.app).post('/api/v1/simulator/scenarios/outage-burst').set(admin.auth)).body.data
        .scenario,
    ).toBe('outage-burst');
    expect(
      (await supertest(ctx.app).post('/api/v1/simulator/scenarios/..%2Fadmin').set(admin.auth)).status,
    ).toBe(400);
    expect(
      (
        await supertest(ctx.app)
          .post('/api/v1/simulator/stream/start')
          .set(admin.auth)
          .send({ interval_ms: 100 })
      ).status,
    ).toBe(400);
    expect(
      (
        await supertest(ctx.app)
          .post('/api/v1/simulator/stream/start')
          .set(admin.auth)
          .send({ batch_size: 101 })
      ).status,
    ).toBe(400);
    expect(
      (await supertest(ctx.app).post('/api/v1/simulator/stream/start').set(admin.auth).send({})).body.data
        .streaming,
    ).toBe(true);
    expect(
      (await supertest(ctx.app).post('/api/v1/simulator/stream/stop').set(admin.auth)).body.data.streaming,
    ).toBe(false);
    expect(fake.calls).toEqual(['list', 'run:outage-burst', 'start:2000:10', 'stop']);
  });

  it('pulls live telemetry and ingests it with source live_pull', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    const res = await supertest(ctx.app)
      .post('/api/v1/monitor/fetch-live')
      .set(admin.auth)
      .send({ count: 7 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ source: 'live_pull', received: 7, healthy: 7 });
    expect(
      (await supertest(ctx.app).post('/api/v1/monitor/fetch-live').set(admin.auth).send({ count: 501 }))
        .status,
    ).toBe(400);
  });

  it('answers 502 SIMULATOR_UNAVAILABLE when the simulator is down', async () => {
    const admin = await login(unreachable, await createUser(unreachable, 'ADMIN'));
    const res = await supertest(unreachable.app).get('/api/v1/simulator/scenarios').set(admin.auth);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('SIMULATOR_UNAVAILABLE');
  });
});
