#!/usr/bin/env node
// POST a JSON file from the host to /monitor with the ingest key (§6.4).
// Usage: npm run ingest:file -- data/samples/edge-cases.json
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run ingest:file -- <path/to/telemetry.json>');
  process.exit(2);
}
const API = process.env.MONITOR_API_URL ?? 'http://localhost:3001';
const key = process.env.INGEST_API_KEY;
if (!key) {
  console.error('INGEST_API_KEY is not set (run through `npm run ingest:file`, which loads .env)');
  process.exit(2);
}

let body;
try {
  body = await readFile(file, 'utf8');
  JSON.parse(body);
} catch (error) {
  console.error(`Cannot read valid JSON from ${file}: ${error.message}`);
  process.exit(1);
}

const res = await fetch(`${API}/monitor`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-ingest-key': key, 'idempotency-key': randomUUID() },
  body,
});
const json = await res.json().catch(() => null);
if (!res.ok) {
  console.error(`HTTP ${res.status}`, JSON.stringify(json?.error ?? json, null, 2));
  process.exit(1);
}
const d = json.data;
console.log(
  `run ${d.run_id}: received ${d.received}, healthy ${d.healthy}, anomalous ${d.anomalous}, rejected ${d.rejected}, ` +
    `alerts created ${d.alerts_created}, updated ${d.alerts_updated}`,
);
for (const alert of d.alerts) console.log(`  [${alert.severity}] ${alert.api_name}: ${alert.alert_message}`);
for (const item of d.rejected_items) console.log(`  rejected #${item.index}: ${item.reason}`);
