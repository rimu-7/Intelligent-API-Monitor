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
| Old | New |
|---|---|
| `NODE_ENV` (as app environment) | `APP_ENV` (`NODE_ENV` is left to Docker/tooling) |
| `PORT` | `PORT` inside containers; host port `MONITOR_API_PORT` |
| `BETTER_AUTH_SECRET` | `JWT_ACCESS_SECRET` |
| `BETTER_AUTH_URL` | removed (`JWT_ISSUER`, `JWT_AUDIENCE` added) |
| `TRUSTED_ORIGINS` | `CORS_ALLOWED_ORIGINS` |
| `AUTH_COOKIE_SECURE` | `COOKIE_SECURE` |
| `REDIS_HOST`, `REDIS_PORT` | removed (`REDIS_URL` only) |
| `DATABASE_POOL_MAX` | removed (pool size fixed in code, 10) |
| `SEED_ADMIN_USERNAME`, `SEED_ADMIN_NAME` | removed (email is the identity) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `REDIS_PASSWORD`, `POSTGRES_*`, `LOG_LEVEL`, `PUBLIC_WEB_URL`, `TRUST_PROXY` | unchanged names (values per §5.1) |

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
