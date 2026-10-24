import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  alertNotifications,
  alerts,
  monitorRuns,
  rejectedTelemetry,
  telemetryLogs,
} from '../../src/infrastructure/database/schema';
import { createUser, login } from '../helpers/auth';
import { ingestHeaders, PDF_EXAMPLE, PDF_TEMPLATE_MESSAGE, readSample } from '../helpers/fixtures';
import { createTestContext, type TestContext } from '../helpers/test-app';

let ctx: TestContext;
let demo: TestContext;
const http = () => supertest(ctx.app);

beforeAll(async () => {
  ctx = await createTestContext({ DEMO_MODE: 'false' });
  demo = await createTestContext({ DEMO_MODE: 'true' });
});
afterAll(async () => {
  await Promise.all([ctx.close(), demo.close()]);
});
beforeEach(async () => {
  await ctx.reset();
});

const ingest = (body: unknown, path = '/monitor') =>
  http()
    .post(path)
    .set(ingestHeaders)
    .send(body as object);
const activeAlerts = () => ctx.container.db.select().from(alerts).where(eq(alerts.status, 'ACTIVE'));

describe('1. PDF example', () => {
  it('flags AppointmentAPI only, with one CRITICAL alert and the exact template text', async () => {
    const res = await ingest(PDF_EXAMPLE);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      source: 'api',
      received: 2,
      processed: 2,
      healthy: 1,
      anomalous: 1,
      rejected: 0,
      alerts_created: 1,
      alerts_updated: 0,
      rejected_items: [],
    });
    expect(res.body.data.results).toEqual([
      { index: 0, api_name: 'PatientDataAPI', status: 'healthy' },
      {
        index: 1,
        api_name: 'AppointmentAPI',
        status: 'anomalous',
        severity: 'CRITICAL',
        anomaly_types: ['SERVER_ERROR', 'HIGH_LATENCY', 'ZERO_RECORDS'],
        alert_id: res.body.data.alerts[0].id,
      },
    ]);
    expect(res.body.data.alerts).toHaveLength(1);
    expect(res.body.data.alerts[0]).toMatchObject({
      api_name: 'AppointmentAPI',
      status: 'ACTIVE',
      severity: 'CRITICAL',
      anomaly_types: ['SERVER_ERROR', 'HIGH_LATENCY', 'ZERO_RECORDS'],
      alert_message: PDF_TEMPLATE_MESSAGE,
      status_code: 500,
      response_time_ms: 5500,
      records_returned: 0,
      last_status_code: 500,
      peak_response_time_ms: 5500,
      occurrence_count: 1,
    });

    const list = await http().get('/alerts').set(ingestHeaders);
    expect(list.status).toBe(403); // the ingest key is a known principal without alerts:read
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    const alertsList = await http().get('/alerts').set(admin.auth);
    expect(alertsList.status).toBe(200);
    expect(alertsList.body.data).toHaveLength(1);
    expect(alertsList.body.meta).toEqual({ total: 1, limit: 50, offset: 0, status: 'ACTIVE' });
    expect(alertsList.body.data[0].id).toBe(res.body.data.alerts[0].id);
  });

  it('serves /api/v1/monitor with the same handler and writes the run', async () => {
    const res = await ingest(PDF_EXAMPLE, '/api/v1/monitor');
    expect(res.status).toBe(200);
    const [run] = await ctx.container.db.select().from(monitorRuns);
    expect(run).toMatchObject({
      source: 'api',
      principal: 'ingest-key',
      received: 2,
      healthy: 1,
      anomalous: 1,
      alertsCreated: 1,
    });
    expect(run?.durationMs).toBeGreaterThanOrEqual(0);
    expect(await ctx.container.db.select().from(telemetryLogs)).toHaveLength(2);
  });
});

describe('2–4. incident deduplication', () => {
  it('2. the same payload twice → one alert, occurrence_count 2', async () => {
    await ingest(PDF_EXAMPLE);
    const second = await ingest(PDF_EXAMPLE);
    expect(second.body.data).toMatchObject({ alerts_created: 0, alerts_updated: 1 });
    const rows = await activeAlerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurrenceCount).toBe(2);
  });

  it('3. 25 identical anomalies in one request → one alert, occurrence_count 25', async () => {
    const batch = Array.from({ length: 25 }, () => ({
      api_name: 'AppointmentAPI',
      response_time_ms: 800,
      status_code: 503,
      records_returned: 12,
    }));
    const res = await ingest(batch);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ anomalous: 25, alerts_created: 1 });
    const rows = await activeAlerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurrenceCount).toBe(25);
  });

  it('4. 10 parallel identical requests → exactly one ACTIVE alert, occurrence_count 10', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => ingest(PDF_EXAMPLE)));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    const rows = await activeAlerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurrenceCount).toBe(10);
    expect(results.reduce((sum, r) => sum + (r.body.data.alerts_created as number), 0)).toBe(1);
  });

  it('keeps different symptom sets for the same API as separate incidents', async () => {
    await ingest([
      { api_name: 'AppointmentAPI', response_time_ms: 300, status_code: 500, records_returned: 3 },
      { api_name: 'AppointmentAPI', response_time_ms: 300, status_code: 200, records_returned: 0 },
    ]);
    expect(await activeAlerts()).toHaveLength(2);
  });
});

describe('5. batch limits and malformed bodies', () => {
  it('accepts a 1000-item batch', async () => {
    const batch = Array.from({ length: 1000 }, (_, i) => ({
      api_name: `Api${i % 20}`,
      response_time_ms: (i * 37) % 7000,
      status_code: i % 50 === 0 ? 503 : 200,
      records_returned: i % 13,
    }));
    const started = Date.now();
    const res = await ingest(batch);
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(1000);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await ctx.container.db.select({ n: sql<number>`count(*)::int` }).from(telemetryLogs)).toEqual([
      { n: 1000 },
    ]);
  });

  it('rejects more than MAX_BATCH_SIZE items with 413 BATCH_TOO_LARGE', async () => {
    const res = await ingest(Array.from({ length: 1001 }, () => PDF_EXAMPLE[0]));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('BATCH_TOO_LARGE');
  });

  it.each([
    ['an empty array', [], 400, 'EMPTY_BATCH'],
    ['an empty logs array', { logs: [] }, 400, 'EMPTY_BATCH'],
    ['a string', 'x', 400, 'INVALID_PAYLOAD'],
    ['an unrelated object', { foo: 1 }, 400, 'INVALID_PAYLOAD'],
    ['logs that is not an array', { logs: 'nope' }, 400, 'INVALID_PAYLOAD'],
  ])('rejects %s', async (_label, body, status, code) => {
    const res = await http()
      .post('/monitor')
      .set(ingestHeaders)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(res.body.error.request_id).toBeTypeOf('string');
  });

  it('rejects malformed JSON with 400 INVALID_JSON', async () => {
    const res = await http()
      .post('/monitor')
      .set(ingestHeaders)
      .set('Content-Type', 'application/json')
      .send('{"api_name": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('rejects a body over MAX_BODY_SIZE with 413 PAYLOAD_TOO_LARGE', async () => {
    const huge = JSON.stringify([{ api_name: 'A', pad: 'x'.repeat(1_100_000) }]);
    const res = await http()
      .post('/monitor')
      .set(ingestHeaders)
      .set('Content-Type', 'application/json')
      .send(huge);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('accepts a single object and a wrapped batch with a source label', async () => {
    const single = await ingest(PDF_EXAMPLE[1]);
    expect(single.status).toBe(200);
    expect(single.body.data.received).toBe(1);

    const wrapped = await ingest({ logs: PDF_EXAMPLE, source: 'webhook' });
    expect(wrapped.status).toBe(200);
    expect(wrapped.body.data.source_detail).toBe('webhook');
  });

  it('returns 422 ALL_ITEMS_REJECTED and still records the run and rejected rows', async () => {
    const res = await ingest(['nope', { response_time_ms: 1 }]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ALL_ITEMS_REJECTED');
    expect(res.body.error.details.rejected_items).toHaveLength(2);
    expect(await ctx.container.db.select().from(monitorRuns)).toHaveLength(1);
    expect(await ctx.container.db.select().from(rejectedTelemetry)).toHaveLength(2);
  });
});

describe('6. edge-cases.json', () => {
  it('produces the outcomes of §6.5 and stores no PHI anywhere', async () => {
    const res = await ingest(readSample('edge-cases.json'));
    expect(res.status).toBe(200);
    const byIndex = new Map(
      (res.body.data.results as { index: number; anomaly_types?: string[]; status: string }[]).map((r) => [
        r.index,
        r,
      ]),
    );
    expect(byIndex.get(0)?.status).toBe('healthy');
    expect(byIndex.get(1)?.anomaly_types).toEqual(['MISSING_RECORDS']);
    expect(byIndex.get(2)?.anomaly_types).toEqual(['INVALID_METRICS']);
    expect(byIndex.get(3)?.anomaly_types).toEqual(['INVALID_METRICS']);
    expect(byIndex.get(4)?.status).toBe('healthy');
    expect(byIndex.get(5)?.anomaly_types).toEqual(['CLIENT_ERROR', 'ZERO_RECORDS']);
    expect(byIndex.get(6)?.anomaly_types).toEqual(['ZERO_RECORDS']);
    expect(byIndex.get(10)?.anomaly_types).toEqual(['AUTH_FAILURE', 'ZERO_RECORDS']);
    expect(
      res.body.data.rejected_items.map((r: { index: number; reason: string }) => [r.index, r.reason]),
    ).toEqual([
      [7, 'INVALID_API_NAME'],
      [8, 'INVALID_API_NAME'],
      [9, 'INVALID_ITEM'],
    ]);
    const identity = (res.body.data.alerts as { api_name: string; severity: string }[]).find(
      (a) => a.api_name === 'IdentityProviderAPI',
    );
    expect(identity?.severity).toBe('CRITICAL');

    // Nothing from unknown keys or rejected items reaches any table.
    const dump = await ctx.container.db.execute(sql`
      SELECT string_agg(t::text, '|') AS dump FROM (
        SELECT row_to_json(a)::text AS t FROM alerts a UNION ALL
        SELECT row_to_json(l)::text FROM telemetry_logs l UNION ALL
        SELECT row_to_json(r)::text FROM rejected_telemetry r UNION ALL
        SELECT row_to_json(m)::text FROM monitor_runs m UNION ALL
        SELECT row_to_json(p)::text FROM monitored_apis p
      ) all_rows`);
    const text = (dump.rows[0] as { dump: string }).dump;
    expect(text).not.toMatch(/Jane Doe|123456|patient_name|mrn|Ignore previous/);
  });
});

describe('7. ingestion auth', () => {
  it('requires credentials when demo mode is off', async () => {
    const res = await http().post('/monitor').send(PDF_EXAMPLE);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a wrong ingest key and accepts the right one', async () => {
    expect((await http().post('/monitor').set('x-ingest-key', 'wrong-key').send(PDF_EXAMPLE)).status).toBe(
      401,
    );
    expect((await ingest(PDF_EXAMPLE)).status).toBe(200);
  });

  it('allows anonymous ingestion and reads only in demo mode', async () => {
    const anon = supertest(demo.app);
    expect((await anon.post('/monitor').send(PDF_EXAMPLE)).status).toBe(200);
    expect((await anon.get('/alerts')).status).toBe(200);
    expect((await anon.get('/api/v1/apis')).status).toBe(200);
    // Write and admin routes stay closed to anonymous callers.
    const [alert] = await activeAlerts();
    expect((await anon.patch(`/api/v1/alerts/${alert?.id}/resolve`).send({})).status).toBe(401);
    expect((await anon.get('/api/v1/users')).status).toBe(401);
    expect((await anon.post('/api/v1/monitor/static').send({})).status).toBe(401);
  });

  it('never downgrades an invalid bearer token to anonymous, even in demo mode', async () => {
    const res = await supertest(demo.app)
      .post('/monitor')
      .set('Authorization', 'Bearer not.a.token')
      .send(PDF_EXAMPLE);
    expect(res.status).toBe(401);
  });
});

describe('8. resolve', () => {
  it('requires alerts:resolve and re-opens a recurring incident as a new alert', async () => {
    const created = await ingest(PDF_EXAMPLE);
    const id = created.body.data.alerts[0].id as string;
    const manager = await login(ctx, await createUser(ctx, 'MANAGER'));
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));

    expect((await http().patch(`/api/v1/alerts/${id}/resolve`).send({})).status).toBe(401);
    expect((await http().patch(`/api/v1/alerts/${id}/resolve`).set(manager.auth).send({})).status).toBe(403);

    const resolved = await http()
      .patch(`/api/v1/alerts/${id}/resolve`)
      .set(admin.auth)
      .send({ note: 'Restarted the pod' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toMatchObject({
      status: 'RESOLVED',
      resolution_source: 'MANUAL',
      resolution_note: 'Restarted the pod',
    });

    const again = await http().patch(`/api/v1/alerts/${id}/resolve`).set(admin.auth).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALERT_ALREADY_RESOLVED');

    expect((await http().get('/alerts').set(admin.auth)).body.data).toHaveLength(0);
    expect((await http().get('/alerts?status=RESOLVED').set(admin.auth)).body.data).toHaveLength(1);

    const reopened = await ingest(PDF_EXAMPLE);
    expect(reopened.body.data.alerts_created).toBe(1);
    expect(reopened.body.data.alerts[0].id).not.toBe(id);
    expect(await activeAlerts()).toHaveLength(1);
  });

  it('validates ids and rejects unknown body keys', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    const bad = await http().patch('/api/v1/alerts/123/resolve').set(admin.auth).send({});
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_ID');
    expect(
      (await http().patch(`/api/v1/alerts/${randomUUID()}/resolve`).set(admin.auth).send({})).status,
    ).toBe(404);
    expect(
      (
        await http()
          .patch(`/api/v1/alerts/${randomUUID()}/resolve`)
          .set(admin.auth)
          .send({ status: 'ACTIVE' })
      ).status,
    ).toBe(400);
  });
});

describe('9. escalation', () => {
  it('escalates WARNING → CRITICAL in place, re-arms AI and records an ESCALATED notification', async () => {
    const warning = await ingest({
      api_name: 'AppointmentAPI',
      response_time_ms: 2500,
      status_code: 200,
      records_returned: 4,
    });
    expect(warning.body.data.alerts[0]).toMatchObject({ severity: 'WARNING', ai_status: 'PENDING' });
    const id = warning.body.data.alerts[0].id as string;
    // WARNING is below ALERT_EMAIL_MIN_SEVERITY (CRITICAL): no notification yet.
    expect(await ctx.container.db.select().from(alertNotifications)).toHaveLength(0);

    const critical = await ingest({
      api_name: 'AppointmentAPI',
      response_time_ms: 6000,
      status_code: 200,
      records_returned: 4,
    });
    expect(critical.body.data.alerts_updated).toBe(1);
    const [row] = await ctx.container.db.select().from(alerts).where(eq(alerts.id, id));
    expect(row).toMatchObject({
      severity: 'CRITICAL',
      previousSeverity: 'WARNING',
      enrichmentVersion: 2,
      aiStatus: 'PENDING',
      responseTimeMs: 6000,
      occurrenceCount: 2,
    });
    expect(row?.escalatedAt).toBeInstanceOf(Date);
    expect(row?.alertMessage).toContain('6000 ms');

    const notifications = await ctx.container.db.select().from(alertNotifications);
    expect(notifications.map((n) => [n.alertId, n.reason, n.status])).toEqual([[id, 'ESCALATED', 'PENDING']]);
  });

  it('records a NEW notification for a new CRITICAL alert', async () => {
    await ingest(PDF_EXAMPLE);
    const notifications = await ctx.container.db.select().from(alertNotifications);
    expect(notifications.map((n) => n.reason)).toEqual(['NEW']);
  });

  it('enqueues one AI job per pending alert version', async () => {
    const res = await ingest(PDF_EXAMPLE);
    const id = res.body.data.alerts[0].id as string;
    const job = await ctx.container.queues.ai.getJob(`ai-${id}-1`);
    expect(job?.data).toMatchObject({ alertId: id, enrichmentVersion: 1, context: 'new_incident' });
  });
});

describe('11. idempotency', () => {
  it('replays the stored response for the same key and body, processing once', async () => {
    const key = randomUUID();
    const first = await http()
      .post('/monitor')
      .set(ingestHeaders)
      .set('Idempotency-Key', key)
      .send(PDF_EXAMPLE);
    const replay = await http()
      .post('/monitor')
      .set(ingestHeaders)
      .set('Idempotency-Key', key)
      .send(PDF_EXAMPLE);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await ctx.container.db.select().from(monitorRuns)).toHaveLength(1);
    expect((await activeAlerts())[0]?.occurrenceCount).toBe(1);
  });

  it('rejects the same key with a different body (422)', async () => {
    const key = randomUUID();
    await http().post('/monitor').set(ingestHeaders).set('Idempotency-Key', key).send(PDF_EXAMPLE);
    const reuse = await http()
      .post('/monitor')
      .set(ingestHeaders)
      .set('Idempotency-Key', key)
      .send([PDF_EXAMPLE[0]]);
    expect(reuse.status).toBe(422);
    expect(reuse.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('requires a UUID key', async () => {
    const res = await http()
      .post('/monitor')
      .set(ingestHeaders)
      .set('Idempotency-Key', 'abc')
      .send(PDF_EXAMPLE);
    expect(res.status).toBe(400);
  });

  it('answers 409 while the first request is still processing', async () => {
    const key = randomUUID();
    await ctx.container.redis.set(
      `idem:monitor:ingest-key:${key}`,
      JSON.stringify({
        state: 'processing',
        bodyHash: (await import('../../src/lib/crypto')).sha256Hex(JSON.stringify(PDF_EXAMPLE)),
      }),
      'EX',
      60,
    );
    const res = await http()
      .post('/monitor')
      .set(ingestHeaders)
      .set('Idempotency-Key', key)
      .send(PDF_EXAMPLE);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
  });
});

describe('12. static file ingestion', () => {
  it('ingests an allowlisted file and lists the allowlist', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    const files = await http().get('/api/v1/monitor/static/files').set(admin.auth);
    expect(files.status).toBe(200);
    expect(files.body.data.map((f: { name: string }) => f.name)).toEqual([
      'edge-cases.json',
      'pdf-example.json',
      'sample-telemetry.json',
    ]);

    const res = await http()
      .post('/api/v1/monitor/static')
      .set(admin.auth)
      .send({ file: 'pdf-example.json' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      source: 'static_file',
      source_detail: 'pdf-example.json',
      anomalous: 1,
    });

    const defaults = await http().post('/api/v1/monitor/static').set(admin.auth).send({});
    expect(defaults.body.data.source_detail).toBe('sample-telemetry.json');
    expect(defaults.body.data.received).toBe(13);
  });

  it.each([
    '../../.env',
    '../.env',
    '/etc/passwd',
    '..%2f.env',
    'sample.json/../../x',
    'missing.json',
    'PDF-EXAMPLE.JSON',
  ])('rejects %s with 400 UNKNOWN_SAMPLE_FILE', async (file) => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    const res = await http().post('/api/v1/monitor/static').set(admin.auth).send({ file });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_SAMPLE_FILE');
  });

  it('requires a logged-in user (the ingest key is not enough)', async () => {
    expect((await http().post('/api/v1/monitor/static').set(ingestHeaders).send({})).status).toBe(403);
  });
});

describe('alerts and APIs endpoints', () => {
  it('lists with filters, paginates, shows detail with recent samples and a summary', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    await ingest(readSample('sample-telemetry.json'));
    await ingest(PDF_EXAMPLE);

    const all = await http().get('/api/v1/alerts?limit=3').set(admin.auth);
    expect(all.body.meta.total).toBe(9);
    expect(all.body.data).toHaveLength(3);
    const critical = await http().get('/api/v1/alerts?severity=CRITICAL&sort=severity').set(admin.auth);
    expect(critical.body.data.every((a: { severity: string }) => a.severity === 'CRITICAL')).toBe(true);
    const byType = await http().get('/api/v1/alerts?anomaly_type=ZERO_RECORDS').set(admin.auth);
    expect(
      byType.body.data.every((a: { anomaly_types: string[] }) => a.anomaly_types.includes('ZERO_RECORDS')),
    ).toBe(true);
    const byApi = await http().get('/api/v1/alerts?api_name=AppointmentAPI').set(admin.auth);
    expect(byApi.body.data.every((a: { api_name: string }) => a.api_name === 'AppointmentAPI')).toBe(true);
    expect((await http().get('/api/v1/alerts?status=BOGUS').set(admin.auth)).status).toBe(400);
    expect((await http().get('/api/v1/alerts?limit=500').set(admin.auth)).status).toBe(400);

    const pdf = (byApi.body.data as { id: string; occurrence_count: number }[]).find(
      (a) => a.occurrence_count === 2,
    );
    const detail = await http().get(`/api/v1/alerts/${pdf?.id}`).set(admin.auth);
    expect(detail.status).toBe(200);
    expect(detail.body.data.recent_samples).toHaveLength(2);
    expect((await http().get('/api/v1/alerts/nope').set(admin.auth)).body.error.code).toBe('INVALID_ID');
    expect((await http().get(`/api/v1/alerts/${randomUUID()}`).set(admin.auth)).status).toBe(404);

    const summary = await http().get('/api/v1/alerts/summary').set(admin.auth);
    expect(summary.body.data.active.total).toBe(9);
    expect(summary.body.data.active.critical).toBe(3);
    expect(summary.body.data.top_apis[0].critical).toBeGreaterThan(0);

    const runs = await http().get('/api/v1/monitor/runs?limit=5').set(admin.auth);
    expect(runs.body.data).toHaveLength(2);
  });

  it('reports monitored APIs with last-hour stats and applies per-API thresholds', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    await ingest([
      { api_name: 'ReportsAPI', response_time_ms: 6000, status_code: 200, records_returned: 3 },
      { api_name: 'ReportsAPI', response_time_ms: 100, status_code: 500, records_returned: 3 },
    ]);
    const list = await http().get('/api/v1/apis').set(admin.auth);
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toMatchObject({
      name: 'ReportsAPI',
      latency_warning_ms: 2000,
      uses_default_thresholds: true,
      last_hour: { requests: 2, error_rate: 0.5, p95_latency_ms: 5705 },
      active_alerts: 2,
    });

    const invalid = await http()
      .patch('/api/v1/apis/ReportsAPI/thresholds')
      .set(admin.auth)
      .send({ latency_warning_ms: 9000, latency_critical_ms: 8000 });
    expect(invalid.status).toBe(400);
    const half = await http()
      .patch('/api/v1/apis/ReportsAPI/thresholds')
      .set(admin.auth)
      .send({ latency_warning_ms: 9000, latency_critical_ms: null });
    expect(half.status).toBe(400);

    const updated = await http()
      .patch('/api/v1/apis/ReportsAPI/thresholds')
      .set(admin.auth)
      .send({ latency_warning_ms: 8000, latency_critical_ms: 15000 });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ latency_warning_ms: 8000, uses_default_thresholds: false });

    // The new threshold applies immediately (cache invalidated): 6000 ms is now healthy.
    const after = await ingest([
      { api_name: 'ReportsAPI', response_time_ms: 6000, status_code: 200, records_returned: 3 },
    ]);
    expect(after.body.data.healthy).toBe(1);
  });

  it('regenerates AI text: 202, new version, PENDING, job enqueued with skipCache', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    const created = await ingest(PDF_EXAMPLE);
    const id = created.body.data.alerts[0].id as string;
    const res = await http().post(`/api/v1/alerts/${id}/regenerate`).set(admin.auth);
    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({ ai_status: 'PENDING' });
    const job = await ctx.container.queues.ai.getJob(`ai-${id}-2`);
    expect(job?.data).toMatchObject({ skipCache: true, context: 'regeneration', enrichmentVersion: 2 });
  });

  it('denies MANAGER on alert and API routes', async () => {
    const manager = await login(ctx, await createUser(ctx, 'MANAGER'));
    for (const path of [
      '/alerts',
      '/api/v1/alerts',
      '/api/v1/alerts/summary',
      '/api/v1/apis',
      '/api/v1/monitor/runs',
    ]) {
      expect((await http().get(path).set(manager.auth)).status).toBe(403);
    }
  });
});
