import { eq } from 'drizzle-orm';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alerts } from '../../src/infrastructure/database/schema';
import { startWorkers, type WorkerHandle } from '../../src/jobs/schedules';
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

describe('10. AI enrichment', () => {
  describe('with no LLM configured', () => {
    let ctx: TestContext;
    let workers: WorkerHandle;
    beforeAll(async () => {
      ctx = await createTestContext({ AI_SYNC_WAIT_MS: '5000' }, { llmProviders: [] });
      workers = await startWorkers(ctx.container);
    });
    afterAll(async () => {
      await workers.close();
      await ctx.close();
    });

    it('answers with the exact template text, ai_status FALLBACK and ai_provider template', async () => {
      const res = await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
      expect(res.status).toBe(200);
      expect(res.body.data.alerts[0]).toMatchObject({
        alert_message: PDF_TEMPLATE_MESSAGE,
        ai_status: 'FALLBACK',
        ai_provider: 'template',
        ai_model: null,
      });
      expect(res.body.data.alerts[0].ai_generated_at).toBeTypeOf('string');
    });
  });

  describe('with a provider injected through the container', () => {
    let ctx: TestContext;
    let workers: WorkerHandle;
    const provider = new FakeProvider('gemini', groundedReply);
    beforeAll(async () => {
      ctx = await createTestContext({ AI_SYNC_WAIT_MS: '5000' }, { llmProviders: [provider] });
      workers = await startWorkers(ctx.container);
    });
    afterAll(async () => {
      await workers.close();
      await ctx.close();
    });

    it('returns guarded LLM text with ai_status COMPLETED within the sync wait', async () => {
      const res = await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
      expect(res.status).toBe(200);
      const [alert] = res.body.data.alerts;
      expect(alert).toMatchObject({
        ai_status: 'COMPLETED',
        ai_provider: 'gemini',
        ai_model: 'gemini-fake-model',
      });
      expect(alert.alert_message).toBe(
        'AppointmentAPI returned HTTP 500 after 5500 ms; appointment workflows are likely failing.',
      );
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]?.user).toContain('"context":"new_incident"');

      const [row] = await ctx.container.db
        .select()
        .from(alerts)
        .where(eq(alerts.id, alert.id as string));
      expect(row?.aiPromptVersion).toBe('alert-v1');
    });

    it('makes one AI call per incident, not per log', async () => {
      await ctx.reset();
      provider.calls = [];
      await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
      await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
      await supertest(ctx.app).post('/monitor').set(ingestHeaders).send(PDF_EXAMPLE);
      expect(provider.calls).toHaveLength(1);
    });

    it('re-runs AI on regeneration (skipping the cache) and on escalation', async () => {
      await ctx.reset();
      provider.calls = [];
      const warning = await supertest(ctx.app)
        .post('/monitor')
        .set(ingestHeaders)
        .send({ api_name: 'LabResultsAPI', response_time_ms: 2500, status_code: 200, records_returned: 3 });
      const id = warning.body.data.alerts[0].id as string;
      expect(warning.body.data.alerts[0].ai_status).toBe('COMPLETED');

      const critical = await supertest(ctx.app)
        .post('/monitor')
        .set(ingestHeaders)
        .send({ api_name: 'LabResultsAPI', response_time_ms: 7000, status_code: 200, records_returned: 3 });
      expect(critical.body.data.alerts[0]).toMatchObject({
        id,
        severity: 'CRITICAL',
        ai_status: 'COMPLETED',
      });
      expect(provider.calls.at(-1)?.user).toContain('"context":"escalation"');
      expect(provider.calls).toHaveLength(2);

      const row = await waitFor(async () => {
        const [current] = await ctx.container.db.select().from(alerts).where(eq(alerts.id, id));
        return current?.aiStatus === 'COMPLETED' ? current : undefined;
      });
      expect(row.enrichmentVersion).toBe(2);
    });
  });
});
