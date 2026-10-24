# Architecture

## Components

| Service             | Responsibility                                                                | State                           | Scales                                      |
| ------------------- | ----------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------- |
| `backend` (:3001)   | HTTP API, ingestion pipeline, auth, SSE hub, Swagger UI                       | none (stateless)                | horizontally; SSE fan-out via Redis pub/sub |
| `worker`            | AI enrichment, email, reconcile / auto-resolve / retention schedulers         | in-memory circuit breakers only | horizontally (BullMQ distributes jobs)      |
| `simulator` (:4400) | synthetic healthcare telemetry, scenarios, stream                             | stream timer                    | dev tool                                    |
| PostgreSQL 17       | source of truth                                                               | all durable data                | vertical / read replicas                    |
| Redis 7             | BullMQ queues, caches, rate limits, idempotency markers, pub/sub, SSE tickets | rebuildable / disposable        | —                                           |
| `migrate`           | one-shot migrations + idempotent admin seed under an advisory lock            | —                               | —                                           |

The API and worker are the same image with different entrypoints (`dist/server.js`, `dist/worker.js`).
Inside the API: `routes → controller → service → repository`. `createApp(container)` never listens; every dependency is
built in `src/container.ts`, so tests run the real app with test doubles (fake LLM providers, mailer, simulator client).

## Data flow

1. **Envelope** (array / `{logs, source}` / single object, ≤ `MAX_BATCH_SIZE`).
2. **Normalize** each item. Only unattributable items are rejected; wrong-but-attributable values become
   `INVALID_METRICS`/`MISSING_RECORDS` anomalies. Unknown keys are dropped (they may carry PHI).
3. **Thresholds** per API: Redis (60 s) → `monitored_apis` → env defaults.
4. **Evaluate** each item with the pure engine (`modules/monitoring/anomaly-engine`): no I/O, clock or randomness.
5. **Aggregate** anomalous items by fingerprint `sha256(api_name | sorted codes)` (count, max severity, trigger, latest,
   peak), sorted by fingerprint.
6. **One transaction** (retried on deadlock/serialization failure): run row, API registry, alert upserts
   (`ON CONFLICT (fingerprint) WHERE status = 'ACTIVE'`), telemetry logs, rejected items, notification rows.
   New alerts carry the deterministic template text and `ai_status = PENDING`.
7. **After commit**: enqueue one AI job per pending alert version (`ai-<id>-<version>`), publish realtime events.
8. **Optional sync wait** (≤ `AI_SYNC_WAIT_MS`) so small requests answer with AI text.
9. **Worker**: cache → providers in `AI_PROVIDER_ORDER` (circuit breaker, timeout, output guard) → template. The update
   applies only if the alert is still `PENDING` at that version. Then `alert.updated` is published and the alert's email
   notifications are queued, so emails carry the final text.

## Design principles

1. **PostgreSQL is the source of truth.** Redis holds only rebuildable or disposable state.
2. **Detection is deterministic and pure.** The engine is unit-tested row by row (`test/unit/anomaly-engine.test.ts`).
3. **AI enriches, never decides.** The LLM writes text; it never decides whether something is an anomaly or how severe.
4. **One AI call per incident, not per log.** Repeats update the open incident; AI runs for new incidents, escalations
   and manual regeneration only.
5. **Every async step is idempotent and reconcilable.** Job ids are deterministic; the reconciler re-enqueues work stuck
   in Postgres every 30 s.
6. **Secure by default, explicit demo mode.** Anonymous access exists only with `DEMO_MODE=true`, refused in production.
7. **No raw payload storage.** Unknown fields never reach the database or logs.

## Failure modes

| Failure                                  | Effect                                             | Handling                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LLM provider down / slow / invalid key   | that provider fails or times out (`AI_TIMEOUT_MS`) | next provider; after 3 failures its circuit opens for 60 s (visible in `/health`); finally the template (`FALLBACK`). Ingestion is never blocked.                                                                                                                              |
| LLM returns invented numbers or bad JSON | output guard rejects it                            | next provider / template; guard rejections do not open the circuit                                                                                                                                                                                                             |
| Redis down                               | queues, caches, rate limits unavailable            | `/health/ready` → 503; rate limiting falls back to in-memory insurance limiters; enqueue failures are logged and the reconciler re-enqueues once Redis is back; caches fall back to Postgres. ioredis reconnects automatically (verified with `docker compose restart redis`). |
| Worker down                              | AI text and emails wait                            | alerts keep their template text; jobs wait in Redis; on restart BullMQ resumes them and the reconciler catches anything lost                                                                                                                                                   |
| Database down                            | nothing can be persisted                           | requests return 503 `SERVICE_UNAVAILABLE`; readiness fails so orchestrators stop routing traffic                                                                                                                                                                               |
| Duplicate delivery (client retry)        | same batch twice                                   | `Idempotency-Key` replays the stored response; the simulator reuses its key on retries                                                                                                                                                                                         |
| Concurrent identical batches             | same fingerprint in parallel transactions          | the partial unique index serialises them; rows are locked in fingerprint order; deadlocks are retried (tested with 10 parallel requests)                                                                                                                                       |
| Email server down                        | send fails                                         | notification marked `FAILED`, BullMQ retries 5× with backoff; reconciler re-queues stuck notifications                                                                                                                                                                         |
| API instance restart                     | SSE clients disconnected                           | `event: shutdown` is sent; clients reconnect with a fresh ticket                                                                                                                                                                                                               |

## Scalability

- Stateless API: any instance can serve any request; SSE events reach every instance via Redis pub/sub.
- Workers scale horizontally; `AI_WORKER_CONCURRENCY` and a 10 jobs/s limiter bound LLM load.
- Batched, chunked writes (≤ 500 rows per statement) and one transaction per request.
- Incident deduplication bounds alert volume and AI cost by the number of distinct incidents, not log volume.
- Caching: thresholds (60 s), alert summary (5 s), API stats (10 s), AI text (24 h, exact-metric keys).
- Next steps at scale: time-partitioned `telemetry_logs`, read replicas for list endpoints, per-tenant isolation.
