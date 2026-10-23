import { eq } from 'drizzle-orm';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogs, refreshTokens } from '../../src/infrastructure/database/schema';
import { createUser, DEFAULT_PASSWORD, login, ORIGIN, refreshCookieOf } from '../helpers/auth';
import { createTestContext, type TestContext } from '../helpers/test-app';

let ctx: TestContext;
const http = () => supertest(ctx.app);

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await ctx.reset();
});

const auditActions = async () => (await ctx.container.db.select().from(auditLogs)).map((row) => row.action);

describe('login', () => {
  it('returns an access token, permissions and a hardened refresh cookie', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: admin.email.toUpperCase(), password: admin.password });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      token_type: 'Bearer',
      expires_in: 900,
      user: { id: admin.id, email: admin.email, role: 'ADMIN' },
    });
    expect(res.body.data.permissions).toContain('users:manage');
    expect(res.body.data.access_token.split('.')).toHaveLength(3);

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('apimon_rt='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).not.toMatch(/Secure/);
    expect(await auditActions()).toContain('auth.login.success');
  });

  it('gives the same answer for a wrong password, an unknown email and an inactive account', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const inactive = await createUser(ctx, 'ADMIN', { isActive: false });
    const attempts = [
      { email: admin.email, password: 'wrong-password-123' },
      { email: 'nobody@example.com', password: DEFAULT_PASSWORD },
      { email: inactive.email, password: inactive.password },
    ];
    for (const attempt of attempts) {
      const res = await http().post('/api/v1/auth/login').send(attempt);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect((await auditActions()).filter((a) => a === 'auth.login.failure')).toHaveLength(3);
  });

  it('rejects unknown body keys (strict schema)', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.co', password: 'x', role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('blocks an email after 5 consecutive failures with 429 + Retry-After', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    for (let i = 0; i < 5; i += 1) {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: admin.email, password: `wrong-password-${i}` });
      expect(res.status).toBe(401);
    }
    const sixth = await http()
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: admin.password });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('blocks unknown emails the same way (no enumeration through the throttle)', async () => {
    for (let i = 0; i < 5; i += 1) {
      await http().post('/api/v1/auth/login').send({ email: 'ghost@example.com', password: 'whatever-123' });
    }
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: 'whatever-123' });
    expect(res.status).toBe(429);
  });

  it('resets the per-email counter after a successful login', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    for (let i = 0; i < 4; i += 1) {
      await http().post('/api/v1/auth/login').send({ email: admin.email, password: 'wrong-password-x' });
    }
    await login(ctx, admin);
    for (let i = 0; i < 4; i += 1) {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: admin.email, password: 'wrong-password-y' });
      expect(res.status).toBe(401);
    }
  });
});

describe('no public registration', () => {
  it.each(['/api/v1/auth/register', '/api/v1/auth/signup', '/api/v1/auth/sign-up/email', '/api/v1/register'])(
    'POST %s → 404',
    async (path) => {
      const res = await http().post(path).send({ email: 'new@example.com', password: DEFAULT_PASSWORD });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    },
  );
});

describe('refresh rotation', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const session = await login(ctx, admin);

    const res = await http().post('/api/v1/auth/refresh').set('Origin', ORIGIN).set('Cookie', session.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeTypeOf('string');
    const rotated = refreshCookieOf(res);
    expect(rotated).not.toBe(session.cookie);

    const rows = await ctx.container.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, admin.id));
    expect(rows).toHaveLength(2);
    const old = rows.find((row) => row.revokedReason === 'rotated');
    expect(old?.replacedById).toBe(rows.find((row) => row.revokedAt === null)?.id);
    expect(new Set(rows.map((row) => row.familyId)).size).toBe(1);
  });

  it('requires an allowed Origin (CSRF defence in depth)', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const session = await login(ctx, admin);
    const missing = await http().post('/api/v1/auth/refresh').set('Cookie', session.cookie);
    expect(missing.status).toBe(403);
    const evil = await http()
      .post('/api/v1/auth/refresh')
      .set('Origin', 'http://evil.example')
      .set('Cookie', session.cookie);
    expect(evil.status).toBe(403);
  });

  it('returns 401 without a cookie', async () => {
    const res = await http().post('/api/v1/auth/refresh').set('Origin', ORIGIN);
    expect(res.status).toBe(401);
  });

  it('answers REFRESH_RACE when a just-rotated token is presented again within 10 s', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const session = await login(ctx, admin);
    const first = await http()
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', session.cookie);
    expect(first.status).toBe(200);

    const race = await http()
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', session.cookie);
    expect(race.status).toBe(401);
    expect(race.body.error.code).toBe('REFRESH_RACE');

    // The family is untouched: the winner's token still works.
    const next = await http()
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', refreshCookieOf(first));
    expect(next.status).toBe(200);
  });

  it('revokes the whole family when a rotated token is reused after the grace window', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const session = await login(ctx, admin);
    const first = await http()
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', session.cookie);
    const current = refreshCookieOf(first);

    // Age the rotation beyond the 10 s grace window.
    await ctx.container.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(Date.now() - 60_000) })
      .where(eq(refreshTokens.revokedReason, 'rotated'));

    const reuse = await http()
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', session.cookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('UNAUTHORIZED');

    const afterTheft = await http().post('/api/v1/auth/refresh').set('Origin', ORIGIN).set('Cookie', current);
    expect(afterTheft.status).toBe(401);
    expect(await auditActions()).toContain('auth.refresh_reuse_detected');
  });
});

describe('logout', () => {
  it('revokes the refresh token server-side and clears the cookie', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const session = await login(ctx, admin);
    const res = await http().post('/api/v1/auth/logout').set('Origin', ORIGIN).set('Cookie', session.cookie);
    expect(res.status).toBe(200);
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/apimon_rt=;/);

    const refresh = await http()
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', session.cookie);
    expect(refresh.status).toBe(401);
    expect(await auditActions()).toContain('auth.logout');
  });
});

describe('access tokens', () => {
  it('rejects malformed and tampered bearer tokens', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const { token } = await login(ctx, admin);
    for (const header of [
      'Bearer',
      'Basic abc',
      `Bearer ${token}x`,
      `Bearer ${token.split('.').slice(0, 2).join('.')}.sig`,
    ]) {
      const res = await http().get('/api/v1/auth/me').set('Authorization', header);
      expect(res.status).toBe(401);
    }
  });

  it('rejects a token whose user was deactivated or whose role changed', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const other = await createUser(ctx, 'ADMIN');
    const adminSession = await login(ctx, admin);
    const otherSession = await login(ctx, other);
    expect((await http().get('/api/v1/users').set(otherSession.auth)).status).toBe(200);

    const demote = await http()
      .patch(`/api/v1/users/${other.id}`)
      .set(adminSession.auth)
      .send({ role: 'MANAGER' });
    expect(demote.status).toBe(200);
    expect(demote.body.data.role).toBe('MANAGER');

    const stale = await http().get('/api/v1/auth/me').set(otherSession.auth);
    expect(stale.status).toBe(401);
    const staleRefresh = await http()
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', otherSession.cookie);
    expect(staleRefresh.status).toBe(401);
    expect(await auditActions()).toContain('user.role_changed');
  });
});

describe('change password', () => {
  it('invalidates existing sessions and returns a fresh one', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const session = await login(ctx, admin);
    const res = await http()
      .post('/api/v1/auth/change-password')
      .set(session.auth)
      .send({ current_password: admin.password, new_password: 'a-brand-new-password-2026' });
    expect(res.status).toBe(200);

    expect((await http().get('/api/v1/auth/me').set(session.auth)).status).toBe(401);
    expect(
      (await http().post('/api/v1/auth/refresh').set('Origin', ORIGIN).set('Cookie', session.cookie)).status,
    ).toBe(401);
    const fresh = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.data.access_token}`);
    expect(fresh.status).toBe(200);

    const relogin = await http()
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: 'a-brand-new-password-2026' });
    expect(relogin.status).toBe(200);
    expect(await auditActions()).toContain('auth.password_changed');
  });

  it('enforces the 12–128 character policy and checks the current password', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const { auth } = await login(ctx, admin);
    const short = await http()
      .post('/api/v1/auth/change-password')
      .set(auth)
      .send({ current_password: admin.password, new_password: 'short' });
    expect(short.status).toBe(400);
    const long = await http()
      .post('/api/v1/auth/change-password')
      .set(auth)
      .send({ current_password: admin.password, new_password: 'x'.repeat(129) });
    expect(long.status).toBe(400);
    const wrong = await http()
      .post('/api/v1/auth/change-password')
      .set(auth)
      .send({ current_password: 'not-my-password', new_password: 'another-valid-password' });
    expect(wrong.status).toBe(400);
  });
});

describe('manager role (reserved, deny by default)', () => {
  it('can log in and read /auth/me but nothing else', async () => {
    const manager = await createUser(ctx, 'MANAGER');
    const { auth } = await login(ctx, manager);

    const me = await http().get('/api/v1/auth/me').set(auth);
    expect(me.status).toBe(200);
    expect(me.body.data.user.role).toBe('MANAGER');
    expect(me.body.data.permissions).toEqual([]);

    expect((await http().get('/api/v1/users').set(auth)).status).toBe(403);
    expect(
      (
        await http()
          .post('/api/v1/users')
          .set(auth)
          .send({ email: 'x@example.com', password: DEFAULT_PASSWORD, role: 'MANAGER' })
      ).status,
    ).toBe(403);
    expect((await http().get('/api/v1/audit-logs').set(auth)).status).toBe(403);
  });
});

describe('user management', () => {
  it('lets an admin create users with a required role and rejects mass assignment', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const { auth } = await login(ctx, admin);

    const created = await http()
      .post('/api/v1/users')
      .set(auth)
      .send({ email: ' New.Manager@Example.com ', password: DEFAULT_PASSWORD, role: 'MANAGER' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      email: 'new.manager@example.com',
      role: 'MANAGER',
      is_active: true,
    });
    expect(created.body.data.password_hash).toBeUndefined();

    const duplicate = await http()
      .post('/api/v1/users')
      .set(auth)
      .send({ email: 'new.manager@example.com', password: DEFAULT_PASSWORD, role: 'MANAGER' });
    expect(duplicate.status).toBe(409);

    const noRole = await http()
      .post('/api/v1/users')
      .set(auth)
      .send({ email: 'x1@example.com', password: DEFAULT_PASSWORD });
    expect(noRole.status).toBe(400);
    const extraKey = await http()
      .post('/api/v1/users')
      .set(auth)
      .send({ email: 'x2@example.com', password: DEFAULT_PASSWORD, role: 'MANAGER', isAdmin: true });
    expect(extraKey.status).toBe(400);
    const weak = await http()
      .post('/api/v1/users')
      .set(auth)
      .send({ email: 'x3@example.com', password: 'short', role: 'MANAGER' });
    expect(weak.status).toBe(400);

    const list = await http().get('/api/v1/users?limit=10').set(auth);
    expect(list.status).toBe(200);
    expect(list.body.meta).toMatchObject({ total: 2, limit: 10, offset: 0 });
    expect(await auditActions()).toContain('user.created');
  });

  it('forbids changing your own role or deactivating yourself', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const { auth } = await login(ctx, admin);
    expect((await http().patch(`/api/v1/users/${admin.id}`).set(auth).send({ role: 'MANAGER' })).status).toBe(
      403,
    );
    expect(
      (await http().patch(`/api/v1/users/${admin.id}`).set(auth).send({ is_active: false })).status,
    ).toBe(403);
  });

  it('validates ids and bodies', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const { auth } = await login(ctx, admin);
    const badId = await http().patch('/api/v1/users/not-a-uuid').set(auth).send({ role: 'MANAGER' });
    expect(badId.status).toBe(400);
    expect(badId.body.error.code).toBe('INVALID_ID');
    expect((await http().patch(`/api/v1/users/${admin.id}`).set(auth).send({})).status).toBe(400);
    expect(
      (
        await http()
          .patch('/api/v1/users/00000000-0000-4000-8000-000000000000')
          .set(auth)
          .send({ role: 'MANAGER' })
      ).status,
    ).toBe(404);
  });

  it('deactivation ends the target user’s sessions', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const manager = await createUser(ctx, 'MANAGER');
    const adminSession = await login(ctx, admin);
    const managerSession = await login(ctx, manager);
    expect(
      (await http().patch(`/api/v1/users/${manager.id}`).set(adminSession.auth).send({ is_active: false }))
        .status,
    ).toBe(200);
    expect((await http().get('/api/v1/auth/me').set(managerSession.auth)).status).toBe(401);
    expect(
      (await http().post('/api/v1/auth/login').send({ email: manager.email, password: manager.password }))
        .status,
    ).toBe(401);
    expect(await auditActions()).toContain('user.deactivated');
  });

  it('never lets two admins demote each other at once (last-admin protection)', async () => {
    const a = await createUser(ctx, 'ADMIN');
    const b = await createUser(ctx, 'ADMIN');
    const sessionA = await login(ctx, a);
    const sessionB = await login(ctx, b);

    const results = await Promise.all([
      http().patch(`/api/v1/users/${b.id}`).set(sessionA.auth).send({ role: 'MANAGER' }),
      http().patch(`/api/v1/users/${a.id}`).set(sessionB.auth).send({ is_active: false }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.code).toBe('LAST_ADMIN');
  });
});
