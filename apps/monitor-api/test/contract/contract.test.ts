import SwaggerParser from '@apidevtools/swagger-parser';
import { ERROR_CODES } from '@apimon/shared';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadOpenapiDocument } from '../../src/modules/docs/docs.routes';
import { createUser, login, ORIGIN, refreshCookieOf } from '../helpers/auth';
import { ingestHeaders, PDF_EXAMPLE } from '../helpers/fixtures';
import { createTestContext, type TestContext } from '../helpers/test-app';

type Operation = { security?: Record<string, string[]>[] };
type OpenApiDoc = {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown> };
};

const doc = loadOpenapiDocument() as unknown as OpenApiDoc;
const METHODS = ['get', 'post', 'patch', 'put', 'delete'];

// ajv-formats is CommonJS; normalise its default export.
const addFormats = ((addFormatsModule as unknown as { default?: typeof addFormatsModule }).default ??
  addFormatsModule) as unknown as (ajv: Ajv2020) => void;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ ...doc, $id: 'openapi' });

const expectSchema = (schema: string, body: unknown) => {
  const validate = ajv.getSchema(`openapi#/components/schemas/${schema}`);
  if (!validate) throw new Error(`schema ${schema} not found`);
  const valid = validate(body);
  expect(
    valid,
    `${schema}: ${JSON.stringify(validate.errors, null, 2)}\nbody: ${JSON.stringify(body).slice(0, 800)}`,
  ).toBe(true);
};

let ctx: TestContext;
const http = () => supertest(ctx.app);

beforeAll(async () => {
  ctx = await createTestContext({ DEMO_MODE: 'false' });
});
afterAll(async () => {
  await ctx.close();
});

describe('0. the document', () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    await expect(SwaggerParser.validate(structuredClone(doc) as never)).resolves.toBeTruthy();
  });

  it('enumerates exactly the shared error codes', () => {
    expect((doc.components.schemas.ErrorCode as { enum: string[] }).enum.sort()).toEqual(
      [...ERROR_CODES].sort(),
    );
  });
});

describe('1. routes ↔ docs/openapi.yaml', () => {
  const documented = Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.keys(item)
      .filter((key) => METHODS.includes(key))
      .map((method) => `${method.toUpperCase()} ${path}`),
  );

  it('documents every registered route', () => {
    const registered = ctx.registry.routes.map(
      (route) => `${route.method.toUpperCase()} ${route.openapiPath}`,
    );
    expect(registered.filter((route) => !documented.includes(route))).toEqual([]);
  });

  it('registers every documented route', () => {
    const registered = ctx.registry.routes.map(
      (route) => `${route.method.toUpperCase()} ${route.openapiPath}`,
    );
    expect(documented.filter((route) => !registered.includes(route))).toEqual([]);
    expect(documented).toHaveLength(ctx.registry.routes.length);
  });

  it('declares public routes as public and protected routes as protected', () => {
    for (const route of ctx.registry.routes) {
      const operation = doc.paths[route.openapiPath]?.[route.method];
      const security = operation?.security ?? [{ bearerAuth: [] }];
      const isPublicDoc = security.length === 0 || security.every((entry) => Object.keys(entry).length === 0);
      const isPublicRoute = 'public' in route.access || 'streamTicket' in route.access;
      expect(isPublicDoc, `${route.method.toUpperCase()} ${route.openapiPath}`).toBe(isPublicRoute);
    }
  });
});

describe('2. response shapes match the component schemas', () => {
  it('ingestion, alerts, APIs, runs and summary', async () => {
    const admin = await login(ctx, await createUser(ctx, 'ADMIN'));
    const ingest = await http()
      .post('/monitor')
      .set(ingestHeaders)
      .send([...PDF_EXAMPLE, 'not-an-item']);
    expect(ingest.status).toBe(200);
    expectSchema('IngestResponse', ingest.body);
    const id = ingest.body.data.alerts[0].id as string;

    expectSchema('AlertListResponse', (await http().get('/alerts').set(admin.auth)).body);
    expectSchema(
      'AlertListResponse',
      (await http().get('/api/v1/alerts?status=ALL&sort=severity').set(admin.auth)).body,
    );
    expectSchema('AlertDetailResponse', (await http().get(`/api/v1/alerts/${id}`).set(admin.auth)).body);
    expectSchema('AlertSummaryResponse', (await http().get('/api/v1/alerts/summary').set(admin.auth)).body);
    expectSchema('ApiListResponse', (await http().get('/api/v1/apis').set(admin.auth)).body);
    expectSchema('RunListResponse', (await http().get('/api/v1/monitor/runs').set(admin.auth)).body);
    expectSchema(
      'SampleFileListResponse',
      (await http().get('/api/v1/monitor/static/files').set(admin.auth)).body,
    );
    expectSchema(
      'ThresholdsResponse',
      (
        await http()
          .patch('/api/v1/apis/AppointmentAPI/thresholds')
          .set(admin.auth)
          .send({ latency_warning_ms: 3000, latency_critical_ms: 9000 })
      ).body,
    );
    expectSchema(
      'StreamTicketResponse',
      (await http().post('/api/v1/alerts/stream-ticket').set(admin.auth)).body,
    );

    const regenerated = await http().post(`/api/v1/alerts/${id}/regenerate`).set(admin.auth);
    expect(regenerated.status).toBe(202);
    expectSchema('AlertResponse', regenerated.body);
    const resolved = await http()
      .patch(`/api/v1/alerts/${id}/resolve`)
      .set(admin.auth)
      .send({ note: 'fixed' });
    expectSchema('AlertResponse', resolved.body);
  });

  it('auth, users, audit, meta and health', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const loginRes = await http()
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: admin.password });
    expectSchema('SessionResponse', loginRes.body);
    const auth = { Authorization: `Bearer ${loginRes.body.data.access_token as string}` };
    expectSchema('MeResponse', (await http().get('/api/v1/auth/me').set(auth)).body);
    expectSchema('UserListResponse', (await http().get('/api/v1/users').set(auth)).body);
    expectSchema(
      'UserResponse',
      (
        await http()
          .post('/api/v1/users')
          .set(auth)
          .send({ email: `m-${Date.now()}@example.com`, password: 'a-valid-password-123', role: 'MANAGER' })
      ).body,
    );
    expectSchema('AuditLogListResponse', (await http().get('/api/v1/audit-logs').set(auth)).body);
    expectSchema('MetaResponse', (await http().get('/api/v1/meta')).body);
    expectSchema('StatusResponse', (await http().get('/health/live')).body);
    expectSchema('StatusResponse', (await http().get('/health/ready')).body);
    expectSchema('HealthResponse', (await http().get('/health')).body);
    const refresh = await http()
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', refreshCookieOf(loginRes));
    expectSchema('SessionResponse', refresh.body);
    expectSchema('LogoutResponse', (await http().post('/api/v1/auth/logout').set('Origin', ORIGIN)).body);
  });

  it('errors use the error envelope', async () => {
    const responses = [
      await http().get('/api/v1/alerts'),
      await http().post('/api/v1/auth/login').send({ email: 'x@example.com', password: 'wrong-password' }),
      await http().post('/monitor').set(ingestHeaders).set('Content-Type', 'application/json').send('{'),
      await http().post('/monitor').set(ingestHeaders).send([]),
      await http().post('/monitor').set(ingestHeaders).send(['x']),
      await http().get('/nope'),
    ];
    expect(responses.map((r) => r.status)).toEqual([401, 401, 400, 400, 422, 404]);
    for (const res of responses) {
      expectSchema('ErrorResponse', res.body);
      expect(res.body.error.request_id).toBe(res.headers['x-request-id']);
    }
  });
});

describe('3. CORS (§15.1)', () => {
  it('echoes an allowed origin with credentials and the documented headers', async () => {
    const res = await http()
      .options('/api/v1/alerts')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-max-age']).toBe('600');
    expect(res.headers['access-control-allow-methods']).toBe('GET,POST,PATCH,OPTIONS');
    const allowed = String(res.headers['access-control-allow-headers']).toLowerCase().split(',');
    expect(allowed).toEqual(['content-type', 'authorization', 'idempotency-key', 'x-request-id']);
    expect(allowed).not.toContain('x-ingest-key');
  });

  it('exposes the documented response headers on simple requests', async () => {
    const res = await http().get('/api/v1/meta').set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(String(res.headers['access-control-expose-headers']).split(',')).toEqual([
      'X-Request-Id',
      'Retry-After',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Idempotent-Replayed',
    ]);
  });

  it('gives a disallowed origin no CORS headers and never errors', async () => {
    const preflight = await http()
      .options('/api/v1/alerts')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(preflight.status).toBeLessThan(400);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
    const simple = await http().get('/api/v1/meta').set('Origin', 'http://evil.example');
    expect(simple.status).toBe(200);
    expect(simple.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('4. refresh cookie attributes (§12.4)', () => {
  it('login and refresh set HttpOnly, SameSite=Strict, Path=/api/v1/auth (no Secure in development)', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const loginRes = await http()
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: admin.password });
    const refreshRes = await http()
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', refreshCookieOf(loginRes));
    for (const res of [loginRes, refreshRes]) {
      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('apimon_rt='),
      );
      expect(cookie).toMatch(/; HttpOnly/);
      expect(cookie).toMatch(/; SameSite=Strict/);
      expect(cookie).toMatch(/; Path=\/api\/v1\/auth/);
      expect(cookie).toMatch(/; Max-Age=\d+/);
      expect(cookie).not.toMatch(/; Secure/);
    }
  });

  it('honours COOKIE_SECURE and COOKIE_SAME_SITE', async () => {
    const secure = await createTestContext({ COOKIE_SECURE: 'true', COOKIE_SAME_SITE: 'none' });
    try {
      const admin = await createUser(secure, 'ADMIN');
      const res = await supertest(secure.app)
        .post('/api/v1/auth/login')
        .send({ email: admin.email, password: admin.password });
      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('apimon_rt='),
      );
      expect(cookie).toMatch(/; Secure/);
      expect(cookie).toMatch(/; SameSite=None/);
      expect(cookie).toMatch(/; HttpOnly/);
    } finally {
      await secure.close();
    }
  });
});

describe('5. docs', () => {
  it('serves Swagger UI with its own CSP and the JSON document; other routes keep helmet defaults', async () => {
    const redirect = await http().get('/docs');
    expect(redirect.status).toBe(301);
    expect(redirect.headers.location).toBe('/docs/');
    const page = await http().get('/docs/');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline'");
    expect((await http().get('/docs/swagger-ui-init.js')).status).toBe(200);
    expect((await http().get('/docs/swagger-ui.css')).status).toBe(200);
    const json = await http().get('/docs/openapi.json');
    expect(json.body.openapi).toBe('3.1.0');
    // Every other route keeps helmet's default policy untouched.
    const api = await http().get('/api/v1/meta');
    const defaultPolicy = (await http().get('/health/live')).headers['content-security-policy'];
    expect(api.headers['content-security-policy']).toBe(defaultPolicy);
    expect(api.headers['content-security-policy']).toContain('upgrade-insecure-requests');
    expect(page.headers['content-security-policy']).not.toBe(defaultPolicy);
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});
