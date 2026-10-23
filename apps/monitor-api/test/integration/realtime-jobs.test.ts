import { eq, sql } from 'drizzle-orm';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alertNotifications, alerts, telemetryLogs } from '../../src/infrastructure/database/schema';
import { runMaintenanceJob, startWorkers, type WorkerHandle } from '../../src/jobs/schedules';
import { createUser, login } from '../helpers/auth';
import { FakeMailer } from '../helpers/fake-mailer';
import { ingestHeaders, PDF_EXAMPLE } from '../helpers/fixtures';
import { createTestContext, type TestContext } from '../helpers/test-app';

const mailer = new FakeMailer();
let ctx: TestContext;
let workers: WorkerHandle;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  ctx = await createTestContext(
    { AI_SYNC_WAIT_MS: '0', ALERT_AUTO_RESOLVE_MINUTES: '30' },
    { llmProviders: [], mailer },
  );
  workers = await startWorkers(ctx.container, { schedulers: false });
  server = ctx.app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await workers.close();
  await ctx.close();
});
beforeEach(async () => {
  await ctx.reset();
  mailer.sent = [];
});

const waitFor = async <T>(
  fn: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 10_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

interface SseEvent {
  event: string;
  data: unknown;
  id?: string;
}

/** Minimal SSE reader over fetch. */
const openStream = async (url: string) => {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const events: SseEvent[] = [];
  const raw: string[] = [];
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pump = (async () => {
    if (!reader) return;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          raw.push(block);
          const fields = Object.fromEntries(
            block
              .split('\n')
              .filter((line) => line.includes(': ') && !line.startsWith(':'))
              .map((line) => [line.slice(0, line.indexOf(': ')), line.slice(line.indexOf(': ') + 2)]),
          );
          if (fields.event)
            events.push({ event: fields.event, data: JSON.parse(fields.data ?? 'null'), id: fields.id });
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // aborted
    }
  })();
  return { response, events, raw, close: () => controller.abort(), done: pump };
};

describe('14. realtime (SSE)', () => {
  it('issues single-use tickets and streams alert events after an ingest', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    const ticketRes = await supertest(ctx.app).post('/api/v1/alerts/stream-ticket').set(admin.auth);
    expect(ticketRes.status).toBe(200);
    expect(ticketRes.body.data.expires_in).toBe(60);
    const { ticket } = ticketRes.body.data as { ticket: string };

    const stream = await openStream(`${baseUrl}/api/v1/alerts/stream?ticket=${ticket}`);
    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(stream.response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(stream.response.headers.get('x-accel-buffering')).toBe('no');
    await waitFor(() => (stream.events.some((e) => e.event === 'ready') ? true : undefined));
    expect(stream.raw[0]).toBe('retry: 5000');

    // The ticket was consumed.
    const reuse = await fetch(`${baseUrl}/api/v1/alerts/stream?ticket=${ticket}`);
    expect(reuse.status).toBe(401);
    await reuse.body?.cancel();

    await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
    const created = await waitFor(() => stream.events.find((e) => e.event === 'alert.created'));
    expect(created.data).toMatchObject({ alert: { api_name: 'AppointmentAPI', severity: 'CRITICAL' } });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => stream.events.find((e) => e.event === 'monitor.run.completed'));
    // The worker publishes alert.updated once the (template) enrichment lands.
    await waitFor(() => stream.events.find((e) => e.event === 'alert.updated'));

    stream.close();
    await stream.done;
  });

  it('rejects missing, invalid and anonymous stream requests', async () => {
    const noTicket = await fetch(`${baseUrl}/api/v1/alerts/stream`);
    expect(noTicket.status).toBe(401);
    const bogus = await fetch(`${baseUrl}/api/v1/alerts/stream?ticket=${'x'.repeat(43)}`);
    expect(bogus.status).toBe(401);
    expect((await supertest(ctx.app).post('/api/v1/alerts/stream-ticket')).status).toBe(401);
    const manager = await login(ctx, await createUser(ctx, 'MANAGER'));
    expect((await supertest(ctx.app).post('/api/v1/alerts/stream-ticket').set(manager.auth)).status).toBe(
      403,
    );
  });

  it('caps streams per user at 5', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    const streams = [];
    for (let i = 0; i < 5; i += 1) {
      const { ticket } = (await supertest(ctx.app).post('/api/v1/alerts/stream-ticket').set(admin.auth)).body
        .data as { ticket: string };
      streams.push(await openStream(`${baseUrl}/api/v1/alerts/stream?ticket=${ticket}`));
    }
    const { ticket } = (await supertest(ctx.app).post('/api/v1/alerts/stream-ticket').set(admin.auth)).body
      .data as { ticket: string };
    const sixth = await fetch(`${baseUrl}/api/v1/alerts/stream?ticket=${ticket}`);
    expect(sixth.status).toBe(429);
    await sixth.body?.cancel();
    for (const stream of streams) stream.close();
    await Promise.all(streams.map((s) => s.done));
  });
});

describe('email notifications', () => {
  it('sends exactly one email with the final text for a new CRITICAL incident', async () => {
    const res = await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
    const id = res.body.data.alerts[0].id as string;
    await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);

    const [notification] = await waitFor(async () => {
      const rows = await ctx.container.db
        .select()
        .from(alertNotifications)
        .where(eq(alertNotifications.alertId, id));
      return rows[0]?.status === 'SENT' ? rows : undefined;
    });
    expect(notification).toMatchObject({ reason: 'NEW', status: 'SENT', attempts: 1 });
    expect(mailer.sent).toHaveLength(1);
    const [email] = mailer.sent;
    expect(email?.subject).toBe('[CRITICAL] AppointmentAPI — SERVER_ERROR, HIGH_LATENCY, ZERO_RECORDS');
    expect(email?.to).toBe('oncall@example.com');
    expect(email?.text).toContain(
      'AppointmentAPI failed with status 500 and returned 0 records (response time 5500 ms).',
    );
    expect(email?.text).toContain(`http://localhost:3000/alerts/${id}`);
    expect(email?.html).toContain('Possible outage or data issue.');
  });

  it('records failures and retries (FAILED → SENT)', async () => {
    mailer.failNext = 1;
    await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
    await waitFor(async () => {
      const [row] = await ctx.container.db.select().from(alertNotifications);
      return row?.status === 'FAILED' ? row : undefined;
    });
    const [failed] = await ctx.container.db.select().from(alertNotifications);
    expect(failed?.lastError).toContain('SMTP 451');
    // BullMQ retries with backoff; drive the retry now instead of waiting 10 s.
    const job = await ctx.container.queues.email.getJob(`email-${failed?.id}`);
    await waitFor(async () => ((await job?.isDelayed()) ? true : undefined));
    await job?.promote();
    await waitFor(async () => {
      const [row] = await ctx.container.db.select().from(alertNotifications);
      return row?.status === 'SENT' ? row : undefined;
    });
    expect(mailer.sent).toHaveLength(1);
  });
});

describe('15. reconciler and scheduled jobs', () => {
  it('re-enqueues an alert left PENDING with no job, which then completes', async () => {
    const res = await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
    const id = res.body.data.alerts[0].id as string;
    await waitFor(async () => {
      const [row] = await ctx.container.db.select().from(alerts).where(eq(alerts.id, id));
      return row?.aiStatus === 'FALLBACK' ? row : undefined;
    });

    // Simulate lost work: alert back to PENDING (new version, no job anywhere), last touched long ago.
    await ctx.container.db.execute(
      sql`UPDATE alerts SET ai_status = 'PENDING', enrichment_version = enrichment_version + 1, updated_at = now() - interval '5 minutes' WHERE id = ${id}`,
    );
    expect(await ctx.container.queues.ai.getJob(`ai-${id}-2`)).toBeUndefined();

    const result = await runMaintenanceJob(ctx.container, 'reconcile');
    expect(result).toMatchObject({ ai: 1 });
    const row = await waitFor(async () => {
      const [current] = await ctx.container.db.select().from(alerts).where(eq(alerts.id, id));
      return current?.aiStatus === 'FALLBACK' ? current : undefined;
    });
    expect(row.enrichmentVersion).toBe(2);
  });

  it('re-sends a notification stuck in PENDING', async () => {
    const res = await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
    const id = res.body.data.alerts[0].id as string;
    await waitFor(() => (mailer.sent.length === 1 ? true : undefined));
    mailer.sent = [];
    await ctx.container.db.execute(
      sql`UPDATE alert_notifications SET status = 'PENDING', created_at = now() - interval '10 minutes' WHERE alert_id = ${id}`,
    );
    const [notification] = await ctx.container.db.select().from(alertNotifications);
    await (await ctx.container.queues.email.getJob(`email-${notification?.id}`))?.remove();

    expect(await runMaintenanceJob(ctx.container, 'reconcile')).toMatchObject({ email: 1 });
    await waitFor(() => (mailer.sent.length === 1 ? true : undefined));
  });

  it('auto-resolves alerts without recurrence for ALERT_AUTO_RESOLVE_MINUTES', async () => {
    const res = await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
    const id = res.body.data.alerts[0].id as string;
    expect(await runMaintenanceJob(ctx.container, 'auto-resolve')).toBe(0);
    await ctx.container.db.execute(
      sql`UPDATE alerts SET last_seen_at = now() - interval '31 minutes' WHERE id = ${id}`,
    );
    expect(await runMaintenanceJob(ctx.container, 'auto-resolve')).toBe(1);
    const [row] = await ctx.container.db.select().from(alerts).where(eq(alerts.id, id));
    expect(row).toMatchObject({
      status: 'RESOLVED',
      resolutionSource: 'AUTO',
      resolutionNote: 'Auto-resolved: no recurrence for 30 minutes',
    });
  });

  it('deletes telemetry and empty runs older than TELEMETRY_RETENTION_DAYS', async () => {
    await supertest(ctx.app)
      .post('/monitor')
      .set(ingestHeaders)
      .send([...PDF_EXAMPLE, 'rejected-item']);
    await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
    const [firstLog] = await ctx.container.db.select().from(telemetryLogs).orderBy(telemetryLogs.id).limit(1);
    await ctx.container.db.execute(
      sql`UPDATE telemetry_logs SET observed_at = now() - interval '8 days' WHERE run_id = ${firstLog?.runId}`,
    );
    await ctx.container.db.execute(
      sql`UPDATE rejected_telemetry SET received_at = now() - interval '8 days'`,
    );
    await ctx.container.db.execute(
      sql`UPDATE monitor_runs SET created_at = now() - interval '8 days' WHERE id = ${firstLog?.runId}`,
    );

    expect(await runMaintenanceJob(ctx.container, 'retention')).toEqual({
      telemetry: 2,
      rejected: 1,
      runs: 1,
    });
    expect(await ctx.container.db.select().from(telemetryLogs)).toHaveLength(2);
  });
});
