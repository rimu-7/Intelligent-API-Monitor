# Architecture Decision Log

Short ADRs. Newest at the bottom. Each: context → decision → consequence.

## ADR-001 PostgreSQL as source of truth

Alerts, telemetry, users and audit need transactions, partial unique indexes and relational queries. **Decision:** PostgreSQL 17. Redis holds only rebuildable or disposable state (queues, cache, rate limits, idempotency markers, pub/sub, SSE tickets).

## ADR-002 BullMQ on Redis for async work

AI calls are slow and fail; email must retry. **Decision:** BullMQ queues (`ai-enrichment`, `email`, `maintenance`) with Job Schedulers for recurring jobs. A reconciler re-enqueues anything stuck in Postgres, so losing Redis never loses work.

## ADR-003 Incident deduplication by fingerprint

**Decision:** `fingerprint = sha256(api_name | sorted codes)` and a partial unique index on `(fingerprint) WHERE status = 'ACTIVE'`. Repeats increment `occurrence_count`; severity is not in the fingerprint, so an incident escalates in place. A different symptom set for the same API is a different incident (documented consequence).

## ADR-004 AI enriches, never decides

The deterministic engine decides whether something is an anomaly and how severe it is. The LLM only writes text, which passes an output guard (numeric fidelity, api_name present). Template text is written first and is always a valid fallback.

## ADR-005 SSE instead of WebSocket

Updates are server → client only. SSE works over plain HTTP, is trivial to proxy and needs no extra library. `EventSource` cannot send headers, so we use single-use tickets.

## ADR-006 Drizzle ORM + committed SQL migrations

Typed schema, plain SQL migrations reviewed in git, and the `sql` template for the upsert the builder cannot express.

## ADR-007 Backend-only scope

The UI is a separate Next.js app built later. This build delivers its contract (OpenAPI, CORS, cookie auth, SSE) and `docs/FRONTEND_INTEGRATION.md`. The existing `web-frontend/` directory is a separate repository and is **not touched**; it is ignored by this repository's `.gitignore`.

## ADR-008 Role mapping and reserved manager role

The existing module's roles `admin` / `manager` map to `user_role` enum values `ADMIN` / `MANAGER`. Only `ADMIN` holds permissions in this build. `MANAGER` can log in and call `GET /auth/me`; everything else is 403 (deny by default). Likely future manager permissions: `alerts:read`, `apis:read`, `alerts:resolve` — enabling them is a one-line change in `ROLE_PERMISSIONS`, no route edits.

## ADR-009 Root git repository

The workspace had no repository at its root (only `web-frontend/` has its own). The spec requires `git mv` and phase commits, so the root was initialised with a baseline commit of the existing code before any change.

## ADR-010 Replace Better Auth, keep the module's logic

The existing module used Better Auth sessions (opaque 7-day tokens, scrypt hashing, username login). It fails A1, A5, A6, A7, A14 and its session model cannot express the §12.4 contract (JWT access token in body + rotated refresh cookie with family reuse detection) without patching library internals. **Decision:** keep the module's structure and rules (central permission map, own-account and last-admin protections, Redis-backed per-IP + per-account lockout, error envelope, log redaction, admin-only user creation) and replace the token/hashing mechanism with jose + argon2id per §12.4–12.5. Username login becomes email login (the spec's identity field); `name`/`username` columns are dropped because no route in §11.2 uses them. Ban/unban maps to `is_active`; hard delete is replaced by deactivation (keeps the audit trail).

## ADR-011 Environment variable renames (existing module → §5.1)

| Old                                                                                                                     | New                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `NODE_ENV` (as app environment)                                                                                         | `APP_ENV` (`NODE_ENV` is left to Docker/tooling)       |
| `PORT`                                                                                                                  | `PORT` inside containers; host port `MONITOR_API_PORT` |
| `BETTER_AUTH_SECRET`                                                                                                    | `JWT_ACCESS_SECRET`                                    |
| `BETTER_AUTH_URL`                                                                                                       | removed (`JWT_ISSUER`, `JWT_AUDIENCE` added)           |
| `TRUSTED_ORIGINS`                                                                                                       | `CORS_ALLOWED_ORIGINS`                                 |
| `AUTH_COOKIE_SECURE`                                                                                                    | `COOKIE_SECURE`                                        |
| `REDIS_HOST`, `REDIS_PORT`                                                                                              | removed (`REDIS_URL` only)                             |
| `DATABASE_POOL_MAX`                                                                                                     | removed (pool size fixed in code, 10)                  |
| `SEED_ADMIN_USERNAME`, `SEED_ADMIN_NAME`                                                                                | removed (email is the identity)                        |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `REDIS_PASSWORD`, `POSTGRES_*`, `LOG_LEVEL`, `PUBLIC_WEB_URL`, `TRUST_PROXY` | unchanged names (values per §5.1)                      |

## ADR-012 `.env.example`: no inline comments after empty values

Docker Compose parses `SMTP_HOST=     # blank = …` as the value `# blank = …` (Node's `--env-file` treats it as empty). Copied verbatim, §5.1 would set `SMTP_HOST`, `*_MODEL`, `SAMPLES_DIR` and `METRICS_TOKEN` to comment text inside containers (enabling `/metrics` with a guessable token). **Decision:** those comments move to the line above the variable, in both `.env.example` and the spec's §5.1 block. Comments after non-empty values are parsed correctly by both and are kept.

## ADR-013 `CONFLICT` error code

§16.2 maps Postgres `23505` to 409 but §11.3 lists no generic 409 code. **Decision:** add `CONFLICT` (409) to the shared `ErrorCode` union; it is also used for "a user with this email already exists".

## ADR-014 Auth details kept or chosen during the port

- **"Admin" is a permission, not a role name.** Last-admin protection counts active users whose role grants `users:manage` (`rolesWithPermission`). Same behaviour as the original module, no role comparisons in services.
- **Last-admin locking.** The original check-then-act had a race. Every active admin row is locked `FOR UPDATE` in id order before the target, so two admins demoting each other at the same moment yield exactly one success and one `409 LAST_ADMIN`. Because an admin cannot act on their own account, this race is the only way to reach `LAST_ADMIN`.
- **Password change starts a fresh session.** All refresh tokens are revoked and `token_version` bumped (A9); the response is a new login payload + cookie so the current client keeps working while every other session ends.
- **Wrong current password → 400**, not 401, so clients do not mistake it for an expired session and start a refresh loop.
- **Refresh failures clear the cookie** (except `REFRESH_RACE`, where the cookie already holds the winner's token).
- **Deactivation instead of deletion**, and ban/unban became `is_active` (ADR-010). Session listing/revocation and profile editing from the original module were dropped: there is no server session table any more and §11.2 does not include them.
- **Login failure audit** stores the submitted email and a reason (`unknown_email` / `bad_password` / `inactive`) for admins investigating credential stuffing; the HTTP response is identical for all three (A3).

## ADR-015 Ingestion details

- **Template text is written in the ingestion transaction** (§9.6 runs in Phase 5, not 6): every alert has valid text from the first moment, and the AI only ever replaces it.
- **`source = simulator`.** A batch pushed with the ingest key whose envelope `source` starts with `simulator` is recorded as `source = 'simulator'` (`source_detail` keeps the label, e.g. `simulator:outage-burst`). Everything else posted to `/monitor` is `api`.
- **Ingestion rate limit key.** "Per principal": users by id, the ingest key as one principal, anonymous demo callers by IP (otherwise one anonymous client could starve all others).
- **Idempotency covers every ingestion route** (`/monitor`, `/api/v1/monitor`, `/static`, `/fetch-live`); the two `/monitor` paths share one scope so a retry on either path replays. A client disconnect before the response releases the key.
- **`error_rate`** in `GET /apis` is the share of last-hour requests with `status_code ≥ 400`; invalid telemetry (null status) is not counted as an error.
- **List query strings tolerate unknown keys** (cache-busting parameters); request bodies are strict.
- **Thresholds can be configured before an API is first seen** (`PATCH /apis/:name/thresholds` upserts the row).

## ADR-016 AI enrichment details

- **What opens a circuit.** §9.4 lists timeouts, network errors, 5xx and 429; acceptance check 11 also requires an _invalid key_ (401/403) to open it. Every failed provider call therefore counts; only output-guard rejections do not (the call itself worked).
- **SDK retries are disabled** (Gemini `retryOptions.attempts = 1`, OpenAI `maxRetries: 0`, Mistral `retryConfig: none`): failover and the breaker own retry behaviour, and the `AI_TIMEOUT_MS` budget stays honest.
- **OpenAI `max_completion_tokens`** is used instead of the deprecated `max_tokens` (openai 7.x types).
- **Prompt details are rebuilt from the trigger sample** with the engine's own rules at enrichment time (alerts do not store per-field issue kinds). For `INVALID_METRICS` the detail names the null fields without guessing the problem kind.
- **Allowed numbers** for the guard include the latency thresholds in seconds as well as the response time (e.g. "5 s threshold").
- **Template fallback text** is recomputed from the stored trigger sample, so FALLBACK text is identical to the initial text.

## ADR-017 Realtime and background-job details

- **SSE access.** `GET /alerts/stream` accepts a single-use ticket, a bearer token (non-browser clients such as `curl`), or anonymous callers in demo mode. Per-stream limits key on the user id, or on the client IP for anonymous streams.
- **Reconciler and BullMQ dedup.** Re-enqueueing with the same job id is ignored while a job with that id exists. For a PENDING alert whose job already _failed_, the reconciler calls `job.retry()`; if the job _completed_ without updating the alert, it is removed and re-added.
- **Email subject** follows §13.2 for NEW notifications; ESCALATED ones append ` (escalated)` and show `WARNING → CRITICAL`.
- **Retention** uses `telemetry_logs.observed_at` (indexed) and `rejected_telemetry.received_at`; runs are deleted only when no telemetry or rejected rows reference them.
- **Missing samples directory** (the worker has no mount) yields an empty allowlist instead of a crash.

## ADR-018 Runtime alert-email recipients

**Context.** Recipients came only from `ALERT_EMAIL_TO`, so changing them meant editing `.env` and restarting, and there
was no way to check from the UI that email works.

**Decision.** A small `app_settings` table (key → JSON) stores the recipient list under key `notifications`, edited by
admins through `PATCH /api/v1/settings/notifications` (new permission `settings:manage`). The worker resolves recipients
per email, so changes apply to the next notification without a restart; when nothing is saved, or the row is unreadable,
`ALERT_EMAIL_TO` (comma-separated allowed) is used. `POST /api/v1/settings/notifications/test` sends one email
synchronously and returns the SMTP result, or 502 `EMAIL_DELIVERY_FAILED` with the server's reason; it is rate-limited to
5 per minute per user because each call opens a real SMTP connection. SMTP host, port, credentials and sender stay in
env only: they are secrets/infrastructure, and the GET endpoint exposes only whether a login is configured, never the
password. Both changes and test sends are audited.

**Consequences.** One extra row read per alert email (emails are rare). The `rbac` unit test now counts 10 permissions.

## ADR-019 No bundled mail catcher; email is opt-in

**Context.** Mailpit caught every email locally, but once a real SMTP server was configured it was unused, and the
smoke test still depended on its inbox.

**Decision.** Mailpit is removed from Compose and `dev:infra`. `EMAIL_ENABLED` now defaults to `false` and
`SMTP_PORT` to 587; `EMAIL_ENABLED=true` without `SMTP_HOST` fails env validation, so a missing mail server is caught
at startup instead of producing failed notifications. Delivery is verified with `POST /api/v1/settings/notifications/test`.
The smoke test only reads the email configuration: sending would mail real recipients on every run. Integration tests
are unaffected (they inject a fake mailer).

**Consequences.** A fresh checkout sends no email until SMTP is configured. `GET /api/v1/settings/notifications`
reports `smtp.host: null` when unset.

## ADR-020 AI runs automatically only for incidents that send an email

**Context.** Every new or escalated incident triggered an LLM call, including warnings nobody is notified about, which
spends tokens on text that is rarely read.

**Decision.** `AI_AUTO_ENRICH` (default `email`) decides inside the ingestion transaction, right after notifications are
created: incidents with a NEW/ESCALATED notification stay `PENDING` and get an AI job (the email waits for that text);
every other new or escalated incident becomes `ai_status = SKIPPED` with `ai_provider = template`, keeping its
deterministic text. A new enum value was chosen over reusing `FALLBACK`, which means "AI was tried and failed".
`POST /alerts/:id/regenerate` is the on-demand path; for a `SKIPPED` alert it uses the original prompt context and may
reuse a cached answer (identical metrics), while re-analysing existing AI text still bypasses the cache. `all` restores
the previous behaviour; `none` never calls the LLM automatically, and emails are queued immediately with the template
text. Skipped alerts are never picked up by the reconciler (it only re-enqueues `PENDING`).

**Consequences.** With email off, `email` mode makes no automatic LLM calls at all. Existing integration suites run with
`AI_AUTO_ENRICH=all` (they test the AI pipeline itself); `ai-auto-enrich.test.ts` covers `email` and `none`.

## ADR-021 Incidents are resolved by people, not by a timer

**Context.** `ALERT_AUTO_RESOLVE_MINUTES` defaulted to 30, so every incident without a recurrence for 30 minutes was
closed by the worker (`resolution_source = AUTO`). Operators returned to a dashboard where hundreds of incidents had
been resolved that nobody had looked at.

**Decision.** The default is now `0`: only an authenticated user with `alerts:resolve` resolves an incident
(`PATCH /api/v1/alerts/:id/resolve`, audited). The auto-resolve job is registered only when the setting is above 0; when
it is 0 the worker also removes the job scheduler from Redis, so a scheduler left by an earlier run stops firing.
Setting a positive value restores the old behaviour for teams that want it.

**Consequences.** Active incidents accumulate until someone resolves them; a repeat of a resolved incident still opens
a new one (partial unique index on ACTIVE). Alerts already auto-resolved stay resolved.
