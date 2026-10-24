import { eq } from 'drizzle-orm';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alerts } from '../../src/infrastructure/database/schema';
import { startWorkers, type WorkerHandle } from '../../src/jobs/schedules';
import { createUser, login } from '../helpers/auth';
import { FakeMailer } from '../helpers/fake-mailer';
import { FakeProvider, groundedReply } from '../helpers/fake-providers';
import { ingestHeaders, PDF_EXAMPLE, PDF_TEMPLATE_MESSAGE } from '../helpers/fixtures';
import { createTestContext, type TestContext } from '../helpers/test-app';

const waitFor = async <T>(fn: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

/** WARNING only (latency 2.5 s ≥ 2 s): below the default CRITICAL email threshold. */
const WARNING_SAMPLE = {
  api_name: 'LabResultsAPI',
  response_time_ms: 2500,
  status_code: 200,
  records_returned: 3,
};

const aiStatusOf = async (ctx: TestContext, id: string) => {
  const [row] = await ctx.container.db.select().from(alerts).where(eq(alerts.id, id));
  return row;
};

describe('AI_AUTO_ENRICH=email (default): AI only for incidents that send an email', () => {
  let ctx: TestContext;
  let workers: WorkerHandle;
  const provider = new FakeProvider('gemini', groundedReply);
  const mailer = new FakeMailer();

  beforeAll(async () => {
    ctx = await createTestContext(
      { AI_AUTO_ENRICH: 'email', AI_SYNC_WAIT_MS: '5000' },
      { llmProviders: [provider], mailer },
    );
    workers = await startWorkers(ctx.container, { schedulers: false });
  });
  afterAll(async () => {
    await workers.close();
    await ctx.close();
  });
  beforeEach(async () => {
    await ctx.reset();
    provider.calls = [];
    mailer.sent = [];
  });

  it('skips AI for an incident below the email threshold and keeps the rule-based text', async () => {
    const res = await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(WARNING_SAMPLE);
    expect(res.status).toBe(200);
    expect(res.body.data.alerts[0]).toMatchObject({
      severity: 'WARNING',
      ai_status: 'SKIPPED',
      ai_provider: 'template',
      ai_model: null,
    });
    expect(res.body.data.alerts[0].alert_message).toContain('LabResultsAPI');
    expect(provider.calls).toHaveLength(0);
  });

  it('runs AI for an incident that sends an email, and the email carries the AI text', async () => {
    const res = await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
    expect(res.body.data.alerts[0]).toMatchObject({ severity: 'CRITICAL', ai_status: 'COMPLETED' });
    expect(provider.calls).toHaveLength(1);
    await waitFor(() => Promise.resolve(mailer.sent.length > 0 ? true : undefined));
    expect(mailer.sent[0]?.text).toContain('appointment workflows are likely failing');
  });

  it('runs AI when a skipped incident escalates to an emailed severity', async () => {
    const warning = await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(WARNING_SAMPLE);
    const id = warning.body.data.alerts[0].id as string;
    expect(warning.body.data.alerts[0].ai_status).toBe('SKIPPED');

    const critical = await supertest(ctx.app)
      .post('/monitor')
      .set(ingestHeaders)
      .send({ ...WARNING_SAMPLE, response_time_ms: 7000 });
    expect(critical.body.data.alerts[0]).toMatchObject({ id, severity: 'CRITICAL', ai_status: 'COMPLETED' });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.user).toContain('"context":"escalation"');
  });

  it('generates AI on request for a skipped incident, using the original prompt', async () => {
    const warning = await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(WARNING_SAMPLE);
    const id = warning.body.data.alerts[0].id as string;
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));

    const res = await supertest(ctx.app).post(`/api/v1/alerts/${id}/regenerate`).set(admin.auth);
    expect(res.status).toBe(202);
    const row = await waitFor(async () => {
      const current = await aiStatusOf(ctx, id);
      return current?.aiStatus === 'COMPLETED' ? current : undefined;
    });
    expect(row.aiProvider).toBe('gemini');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.user).toContain('"context":"new_incident"');
  });

  it('skips AI for every incident when email is disabled', async () => {
    const quiet = await createTestContext(
      { AI_AUTO_ENRICH: 'email', EMAIL_ENABLED: 'false', AI_SYNC_WAIT_MS: '0' },
      { llmProviders: [provider] },
    );
    try {
      const res = await supertest(quiet.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
      expect(res.body.data.alerts[0]).toMatchObject({ severity: 'CRITICAL', ai_status: 'SKIPPED' });
      expect(provider.calls).toHaveLength(0);
    } finally {
      await quiet.close();
    }
  });
});

describe('AI_AUTO_ENRICH=none: AI only on request', () => {
  let ctx: TestContext;
  let workers: WorkerHandle;
  const provider = new FakeProvider('gemini', groundedReply);
  const mailer = new FakeMailer();

  beforeAll(async () => {
    ctx = await createTestContext(
      { AI_AUTO_ENRICH: 'none', AI_SYNC_WAIT_MS: '0' },
      { llmProviders: [provider], mailer },
    );
    workers = await startWorkers(ctx.container, { schedulers: false });
  });
  afterAll(async () => {
    await workers.close();
    await ctx.close();
  });

  it('still emails critical incidents right away, with the rule-based text', async () => {
    const res = await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
    expect(res.body.data.alerts[0]).toMatchObject({ severity: 'CRITICAL', ai_status: 'SKIPPED' });
    await waitFor(() => Promise.resolve(mailer.sent.length > 0 ? true : undefined));
    expect(mailer.sent[0]?.text).toContain(PDF_TEMPLATE_MESSAGE);
    expect(provider.calls).toHaveLength(0);
  });
});
