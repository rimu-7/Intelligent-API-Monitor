import { eq } from 'drizzle-orm';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs } from '../../src/infrastructure/database/schema';
import { createUser, login } from '../helpers/auth';
import { FakeMailer } from '../helpers/fake-mailer';
import { createTestContext, type TestContext } from '../helpers/test-app';

const mailer = new FakeMailer();
let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext({ ALERT_EMAIL_TO: 'oncall@example.com, backup@example.com' }, { mailer });
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await ctx.reset();
  mailer.sent = [];
  mailer.failNext = 0;
});

const PATH = '/api/v1/settings/notifications';

describe('alert-email settings', () => {
  it('requires settings:manage', async () => {
    expect((await supertest(ctx.app).get(PATH)).status).toBe(401);
    const manager = await login(ctx, await createUser(ctx, 'MANAGER'));
    expect((await supertest(ctx.app).get(PATH).set(manager.auth)).status).toBe(403);
    expect(
      (
        await supertest(ctx.app)
          .patch(PATH)
          .set(manager.auth)
          .send({ alert_email_to: ['a@b.co'] })
      ).status,
    ).toBe(403);
    expect((await supertest(ctx.app).post(`${PATH}/test`).set(manager.auth).send({})).status).toBe(403);
  });

  it('falls back to ALERT_EMAIL_TO, then serves the saved recipients', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    const initial = await supertest(ctx.app).get(PATH).set(admin.auth);
    expect(initial.status).toBe(200);
    expect(initial.body.data).toMatchObject({
      alert_email_to: ['oncall@example.com', 'backup@example.com'],
      source: 'environment',
      email_enabled: true,
      updated_at: null,
    });

    const updated = await supertest(ctx.app)
      .patch(PATH)
      .set(admin.auth)
      .send({ alert_email_to: ['Me@Example.com', 'me@example.com', 'team@example.com'] });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data).toMatchObject({
      alert_email_to: ['me@example.com', 'team@example.com'],
      source: 'database',
    });
    expect(await ctx.container.settings.alertRecipients()).toEqual(['me@example.com', 'team@example.com']);

    const [audit] = await ctx.container.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'settings.notifications_changed'));
    expect(audit?.metadata).toEqual({
      from: ['oncall@example.com', 'backup@example.com'],
      to: ['me@example.com', 'team@example.com'],
    });
  });

  it('rejects invalid, empty and unknown input', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    for (const body of [
      { alert_email_to: [] },
      { alert_email_to: ['not-an-email'] },
      { alert_email_to: Array.from({ length: 11 }, (_, i) => `u${String(i)}@example.com`) },
      { alert_email_to: ['a@example.com'], extra: true },
      {},
    ]) {
      const res = await supertest(ctx.app).patch(PATH).set(admin.auth).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('sends a test email to the saved recipients or an explicit address', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    await supertest(ctx.app)
      .patch(PATH)
      .set(admin.auth)
      .send({ alert_email_to: ['me@example.com'] });

    const res = await supertest(ctx.app).post(`${PATH}/test`).set(admin.auth).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ delivered: true, to: ['me@example.com'] });
    expect(typeof res.body.data.message_id).toBe('string');
    expect(mailer.sent[0]?.to).toBe('me@example.com');
    expect(mailer.sent[0]?.subject).toBe('[API Monitor] Test email');

    const explicit = await supertest(ctx.app)
      .post(`${PATH}/test`)
      .set(admin.auth)
      .send({ to: 'other@example.com' });
    expect(explicit.body.data.to).toEqual(['other@example.com']);
  });

  it('reports SMTP failures as 502 EMAIL_DELIVERY_FAILED', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    mailer.failNext = 1;
    const res = await supertest(ctx.app).post(`${PATH}/test`).set(admin.auth).send({});
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('EMAIL_DELIVERY_FAILED');
    expect(res.body.error.message).toContain('SMTP 451');
  });

  it('limits test emails to 5 per minute per user', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    for (let i = 0; i < 5; i += 1) {
      expect((await supertest(ctx.app).post(`${PATH}/test`).set(admin.auth).send({})).status).toBe(200);
    }
    const limited = await supertest(ctx.app).post(`${PATH}/test`).set(admin.auth).send({});
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});
