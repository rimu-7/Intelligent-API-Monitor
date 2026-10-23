#!/usr/bin/env node
// End-to-end smoke test against the running compose stack (§18).
// Usage: npm run smoke   (reads .env via `node --env-file=.env`)
import { randomUUID } from 'node:crypto';

const API = process.env.MONITOR_API_URL ?? 'http://localhost:3001';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const INGEST_KEY = process.env.INGEST_API_KEY;
const EMAIL = process.env.SEED_ADMIN_EMAIL;
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const PDF = [
  { api_name: 'PatientDataAPI', response_time_ms: 1200, status_code: 200, records_returned: 50 },
  { api_name: 'AppointmentAPI', response_time_ms: 5500, status_code: 500, records_returned: 0 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let step = 0;
const ok = (message) => console.log(`  ✓ ${message}`);
const section = (title) => console.log(`\n${++step}. ${title}`);
const fail = (message, detail) => {
  console.error(`\n  ✗ ${message}`);
  if (detail !== undefined) console.error(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
  process.exit(1);
};

async function call(method, path, { body, headers = {}, expect = [200] } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => null);
  if (!expect.includes(res.status)) fail(`${method} ${path} → HTTP ${res.status}`, json);
  return json;
}

const isPdfAlert = (alert) =>
  alert.api_name === 'AppointmentAPI' &&
  alert.anomaly_types.join(',') === 'SERVER_ERROR,HIGH_LATENCY,ZERO_RECORDS' &&
  alert.status === 'ACTIVE';

if (!INGEST_KEY || !EMAIL || !PASSWORD) fail('INGEST_API_KEY, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set (run with --env-file=.env)');

console.log(`Smoke test against ${API}`);

section('Wait for readiness');
for (let i = 0; ; i += 1) {
  try {
    const res = await fetch(`${API}/health/ready`, { signal: AbortSignal.timeout(3_000) });
    if (res.ok) break;
  } catch {
    // not up yet
  }
  if (i >= 60) fail('API not ready after 120 s');
  await sleep(2_000);
}
ok('GET /health/ready → 200');

section('Log in as the seeded admin');
const session = await call('POST', '/api/v1/auth/login', { body: { email: EMAIL, password: PASSWORD } });
const auth = { authorization: `Bearer ${session.data.access_token}` };
ok(`logged in as ${session.data.user.email} (${session.data.permissions.length} permissions)`);

section('Ingest the PDF example');
const ingest = await call('POST', '/monitor', { body: PDF, headers: { 'x-ingest-key': INGEST_KEY, 'idempotency-key': randomUUID() } });
const { healthy, anomalous } = ingest.data;
if (healthy !== 1 || anomalous !== 1) fail('expected healthy 1, anomalous 1', ingest.data);
ok('POST /monitor → 200, healthy 1, anomalous 1');

section('Wait for AI enrichment (≤ 30 s)');
let alert;
for (let i = 0; i < 30; i += 1) {
  const list = await call('GET', '/alerts', { headers: auth });
  alert = list.data.find(isPdfAlert);
  if (alert && alert.ai_status !== 'PENDING') break;
  await sleep(1_000);
}
if (!alert) fail('PDF alert not listed by GET /alerts');
if (alert.ai_status === 'PENDING') fail('alert still PENDING after 30 s', alert);
if (alert.severity !== 'CRITICAL') fail('expected CRITICAL', alert);
ok(`ai_status ${alert.ai_status} via ${alert.ai_provider}; occurrence_count ${alert.occurrence_count}`);
console.log(`    "${alert.alert_message}"`);

section('Resolve it');
await call('PATCH', `/api/v1/alerts/${alert.id}/resolve`, { headers: auth, body: { note: 'smoke test' } });
const active = await call('GET', '/alerts', { headers: auth });
if (active.data.some((a) => a.id === alert.id)) fail('resolved alert still listed as ACTIVE');
const resolved = await call('GET', '/alerts?status=RESOLVED&limit=100', { headers: auth });
if (!resolved.data.some((a) => a.id === alert.id)) fail('resolved alert missing from status=RESOLVED');
ok('PATCH /resolve → 200; gone from ACTIVE, present in RESOLVED');

section('Run the outage-burst scenario through the API proxy');
const isBurst = (a) => a.api_name === 'AppointmentAPI' && a.anomaly_types.join(',') === 'SERVER_ERROR' && a.status === 'ACTIVE';
const before = (await call('GET', '/alerts?api_name=AppointmentAPI&limit=100', { headers: auth })).data.find(isBurst);
await call('POST', '/api/v1/simulator/scenarios/outage-burst', { headers: auth });
const after = (await call('GET', '/alerts?api_name=AppointmentAPI&limit=100', { headers: auth })).data.find(isBurst);
if (!after) fail('outage-burst alert not found');
const delta = after.occurrence_count - (before?.occurrence_count ?? 0);
if (delta !== 25) fail(`expected occurrence_count +25, got +${delta}`, after);
if (!before && after.occurrence_count !== 25) fail('new outage-burst alert should have occurrence_count 25', after);
ok(`one alert, occurrence_count ${after.occurrence_count} (+25)`);

section('Check Mailpit for alert email');
let messages = 0;
for (let i = 0; i < 15 && messages === 0; i += 1) {
  const res = await fetch(`${MAILPIT}/api/v1/messages`).catch(() => null);
  messages = res?.ok ? (await res.json()).total : 0;
  if (messages === 0) await sleep(1_000);
}
if (messages < 1) fail(`no messages in Mailpit (${MAILPIT})`);
ok(`${messages} message(s) in Mailpit`);

console.log('\nSmoke test passed.');
