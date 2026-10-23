# Phase 0 Audit

Audit of the repository as it existed before this build (baseline commit `99b9b72`), compared against `docs/PROJECT_SPEC.md` v3.0.

## 1. Inventory

| Path | What it is | Verdict |
|---|---|---|
| `express-backend/` | Express 5 + TypeScript API: Better Auth role-based auth (roles `admin`, `manager`), user management, `/health`. Drizzle schema for Better Auth tables, postgres.js driver. | **Port** → `apps/monitor-api` (`git mv`). Auth/users logic ported into `modules/auth` + `modules/users`; Better Auth itself replaced (see §3). |
| `express-backend/dist/` | Stale compiled output (gitignored). | Delete. |
| `Dockerfile` (root) | Single-stage-ish image for `express-backend`, `curl` healthcheck, alpine. | **Delete** — superseded by `apps/monitor-api/Dockerfile` (§17.1). |
| `docker-compose.yml` (root) | postgres 16, redis 7, api (bind-mounted dev target), frontend. Hardcoded default secrets. | **Delete** — superseded by `compose.yaml` (§17.2). |
| `.env.example` (root) | Better Auth variables. | **Rewrite** verbatim per §5.1. |
| `.dockerignore` | Minimal. | **Rewrite** per §17.2. |
| `yaak/api-endpoints.json` | Postman/Yaak collection for the old auth API. | **Delete** — superseded by `docs/api.http` + `docs/openapi.yaml`. |
| `web-frontend/` | Separate Next.js app with its own git repository. | **Out of scope — untouched.** Ignored by this repository's `.gitignore`. It targets the old Better Auth contract (username login, `localStorage` token) and must be migrated to §15 when the frontend phase begins. |
| `api-monitoring-system/`, `response-server/` | Named in the spec. | **Not present.** Monitoring pipeline, simulator and everything except auth are written new. |

## 2. Gap list per spec section

| Spec § | State before | Gap / action |
|---|---|---|
| §1 Goal / traceability | Only auth + users existed. | Everything except auth is new: ingestion, engine, AI, alerts, SSE, email, simulator. |
| §2 Architecture | Single process, no worker, no queue. | Add `monitor-worker` entrypoint, BullMQ, Redis pub/sub event bus, simulator service. |
| §3 Tech stack | Express 5, Zod 4, Drizzle, ioredis, pino ✓. postgres.js (not `pg`), Better Auth (not jose/argon2), express-rate-limit (not rate-limiter-flexible), compression, dotenv, nodemon, TypeScript 7. | Switch to `pg`, jose, argon2, rate-limiter-flexible, tsup, tsx, Vitest; drop compression (buffers SSE), dotenv (`--env-file`), nodemon; TypeScript 5 per spec. |
| §4 Layout | Flat single package. | npm workspaces `apps/*`, `packages/*`; `@apimon/shared`. |
| §5 Configuration | `env.ts` with Zod, but `console.error`, default admin password, no production guards, `dotenv`. | Rewrite per §5.2 (empty→undefined, boolean enum parse, prod guards, banner). |
| §6–§9 Telemetry, engine, pipeline, AI | Absent. | New. |
| §10 Database | Better Auth tables (`users`, `sessions`, `accounts`, `verifications`), text ids, `user_role ('admin','manager')`. | New schema per §10 (uuid ids, upper-case enums). No data migration needed (seed creates admin). |
| §11 HTTP API | `/api/v1/auth/*`, `/api/v1/users/*`, `/health`. No route registry, no `access` declaration. | `secure-router.ts` registry, all §11.2 routes. |
| §12 Auth/RBAC | See §3 below. | Port + harden. |
| §13 Realtime, email, jobs | Absent. | New. |
| §14 Simulator | Absent. | New app `apps/telemetry-simulator`. |
| §15 Frontend contract | Absent. | OpenAPI, FRONTEND_INTEGRATION.md, contract tests. |
| §16 Cross-cutting | pino + redaction (partial), central error handler (leaks stack in dev), graceful shutdown (partial), helmet, CORS (falls back to reflect-any). | Rewrite per §16. |
| §17 Docker | Dev bind-mount image, curl healthcheck, `npm install` in image. | Multi-stage per §17.1, compose per §17.2. |
| §18 Tests | None. | Unit, integration, contract, smoke. |
| §19–§22 | n/a | Phases, docs. |

## 3. Existing auth module

### 3.1 Inventory

| Aspect | Existing implementation (baseline paths) |
|---|---|
| Library | Better Auth 1.7 used as a library (`src/lib/auth.ts:20-56`); its HTTP handler is not mounted. Plugins: `username`, `admin`, `bearer`. |
| Routes | `POST /api/v1/auth/login` (username + password), `POST /logout`, `GET /me`, `PATCH /profile`, `POST /change-password`, `GET /sessions`, `DELETE /sessions/:id`, `POST /sessions/revoke-others` (`src/modules/auth/auth.routes.ts:9-20`). `POST/GET /api/v1/users`, `GET/DELETE /users/:id`, `PATCH /users/:id/role`, `POST /users/:id/ban`, `POST /users/:id/unban` (`src/modules/users/users.routes.ts:10-22`). |
| Middleware | `authenticate` (Better Auth session from cookie or Bearer, Redis blacklist, ban check) `src/middlewares/authenticate.ts:11-41`; `authorize(permissions)` `src/middlewares/authorize.ts:7-13`; `loginRateLimit`/`apiRateLimit` (express-rate-limit + rate-limit-redis) `src/middlewares/rate-limit.ts`; error handler `src/middlewares/error-handler.ts`. |
| Token mechanism | Opaque Better Auth session token (7-day expiry, `src/lib/auth.ts:41-44`), sent as cookie `ams.session_token` or `Authorization: Bearer`. No JWT, no refresh token. |
| Storage | PostgreSQL via Drizzle + postgres.js (`src/db/client.ts`), Better Auth tables (`src/db/schema/auth.ts`); Redis secondary storage for sessions, lockout counters, token blacklist (`src/lib/redis.ts`). |
| Env vars | `NODE_ENV`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, `REDIS_URL`/`REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`, `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD`/`SEED_ADMIN_EMAIL`/`SEED_ADMIN_NAME` (`src/config/env.ts:17-43`). Mapping to §5.1 names is in `docs/DECISIONS.md` (ADR-011). |
| Dependencies | better-auth, @better-auth/redis-storage, express-rate-limit, rate-limit-redis, compression, dotenv, postgres, ioredis, pino, zod, helmet, cors. |
| Roles/permissions | `admin` (user create/list/get/set-role/ban/delete, sessions), `manager` (user list/get, scoped to managers) (`src/lib/permissions.ts:19-27`). |
| Good logic worth keeping | Central permission map; "cannot act on own account"; "last active admin cannot be demoted/banned/deleted" (`src/modules/users/users.service.ts:20-30`); Redis-backed per-IP and per-account lockout; consistent `{success, error:{code,message,details}}` envelope; pino redaction of auth headers/cookies; no public sign-up; graceful shutdown. |

### 3.2 Audit checklist (state of the baseline → state after Phase 3)

"Before" is the baseline evidence. "After" is the evidence in the ported code (`apps/monitor-api/src/...`), filled in during Phase 3.

| # | Before | Evidence (baseline) | After | Evidence (ported) |
|---|---|---|---|---|
| A1 | ✗ | Better Auth's default password hasher is scrypt; no custom hasher configured (`src/lib/auth.ts:34-39`). Not argon2id / bcrypt ≥ 12. | ✓ | argon2id m=19456,t=2,p=1 — `modules/auth/password.service.ts` |
| A2 | ✗ | Min length 8 (`src/lib/auth.ts:37`, `src/modules/users/users.schema.ts:13`, `src/modules/auth/auth.schema.ts:13`); max 128 ✓. | ✓ | 12–128 — `modules/auth/auth.schemas.ts` (`passwordPolicy`) |
| A3 | ✗ | Generic message, but it discloses remaining attempts (`src/modules/auth/auth.service.ts:74-77`); dummy-hash timing equalisation not verified; banned accounts get a distinct 403 message after a correct password (`:51-54`). | ✓ | dummy-hash verify on unknown email, single `INVALID_CREDENTIALS` for unknown/wrong/inactive — `modules/auth/auth.service.ts` |
| A4 | ~ | Per-IP and per-account counters in Redis (`src/lib/redis.ts:140-185`), but a per-account lock also locks the IP and vice versa, the check fails **open** on Redis errors (`:130-133`), and there is no in-memory insurance. | ✓ | rate-limiter-flexible Redis limiters + in-memory insurance — `modules/auth/login-throttle.ts` |
| A5 | ✗ | No JWT. Opaque 7-day bearer session token (`src/lib/auth.ts:41-44`). | ✓ | jose HS256, `algorithms:['HS256']`, iss/aud verified, `exp` = 900 s, claims `sub/role/tv/jti` only — `modules/auth/token.service.ts` |
| A6 | ✗ | Login returns the session token in the body (`src/modules/auth/auth.controller.ts:26`) and the existing web client stores it in `localStorage` (`web-frontend/lib/api.ts:38-50`); cookie SameSite default `lax`. | ✓ | access token in memory (documented, `docs/FRONTEND_INTEGRATION.md`); refresh cookie `apimon_rt` HttpOnly, SameSite from env (default Strict), Secure in prod, Path `/api/v1/auth` — `modules/auth/auth.controller.ts` |
| A7 | ✗ | No refresh tokens, rotation or reuse detection. | ✓ | 32-byte random, sha256 at rest, rotation, family revoke on reuse, 10 s race grace — `modules/auth/auth.service.ts`, `refresh-token.repository.ts` |
| A8 | ✓ | `signOut` + Redis blacklist (`src/modules/auth/auth.service.ts:84-90`). | ✓ | refresh token revoked in DB on logout — `modules/auth/auth.service.ts` (`logout`) |
| A9 | ✗ | Role change only scans Redis for keys whose *value contains* the user id (`src/lib/redis.ts:238-274`; the async `data` handler races the `end` handler so deletions can be missed); DB sessions survive a role change; password change revokes other sessions only when the client asks (`src/modules/auth/auth.schema.ts:18`). | ✓ | `token_version + 1`, `user:<id>` cache delete, all refresh tokens revoked — `modules/users/users.service.ts`, `modules/auth/auth.service.ts` (`changePassword`) |
| A10 | ~ | Central map exists (`src/lib/permissions.ts`), but `actor.role === "admin"` is hard-coded in the service (`src/modules/users/users.service.ts:12`) and nothing forces a route to declare access. | ✓ | `ROLE_PERMISSIONS` in `@apimon/shared`; `secure-router.ts` requires `access` on every route (type error otherwise) + registry checked by contract tests |
| A11 | ~ | Body schemas are non-strict `z.object` (unknown keys silently stripped) (`src/modules/users/users.schema.ts:22`, `src/modules/auth/auth.schema.ts:4`). | ✓ | `z.strictObject` on every auth/user body — `auth.schemas.ts`, `users.schemas.ts` |
| A12 | ✓ | `disableSignUp: true`, Better Auth handler not mounted (`src/lib/auth.ts:36`). | ✓ | no registration route exists (integration test asserts 404) |
| A13 | ✓ | `assertNotSelf`, `assertNotLastAdmin` (`src/modules/users/users.service.ts:20-30`) — kept. Check-then-act race noted. | ✓ | same rules, now inside a transaction with `SELECT … FOR UPDATE` on admins — `modules/users/users.service.ts` / `users.repository.ts` |
| A14 | ✗ | Cookie SameSite `lax`; no `Origin` check on cookie-authenticated routes. | ✓ | SameSite Strict default + `Origin` allowlist on `/refresh` and `/logout` — `modules/auth/auth.controller.ts` (`assertAllowedOrigin`) |
| A15 | ✗ | `origin: TRUSTED_ORIGINS.length > 0 ? TRUSTED_ORIGINS : true` reflects **any** origin with credentials when the list is empty (`src/app.ts:23`). | ✓ | exact allowlist, `*` rejected by env validation — `app.ts`, `config/env.ts` |
| A16 | ✗ | Hardcoded secret defaults in `docker-compose.yml` (`BETTER_AUTH_SECRET`, seed password) and `src/config/env.ts:40` (default admin password); no `.gitignore` in the repo. | ✓ | no defaults for secrets; `dev-only-` values rejected in production; `.gitignore` covers `.env` |
| A17 | ~ | Redacts authorization, cookie, set-cookie, `*.password` (`src/lib/logger.ts:6-14`) but not `newPassword`/`currentPassword`, ingest keys or tokens. | ✓ | full §16.1 redaction list — `infrastructure/logger.ts`; no bodies logged |
| A18 | ✗ | Stack trace and cause returned in the response whenever `NODE_ENV !== 'production'` (`src/middlewares/error-handler.ts:53-58`). | ✓ | generic 500 body, stack only in logs — `http/middleware/error-handler.ts` |
| A19 | ✗ | No audit log. | ✓ | `audit_logs` table + `audit.service.ts`, all §12.6 events |
| A20 | n/a | No secret comparisons in module code (delegated to Better Auth). | ✓ | `safeEqual(sha256(a), sha256(b))` — `lib/crypto.ts` |
| A21 | ✓ | `npm audit --omit=dev`: 4 moderate (esbuild via drizzle-kit, dev tool), 0 high/critical. | ✓ | re-checked in Phase 10 |
| A22 | n/a | No password reset feature. | n/a | not implemented (disabled by absence) |

## 4. Port / rewrite / delete

| Item | Action |
|---|---|
| `express-backend/` → `apps/monitor-api/` | `git mv` (history kept). |
| `src/lib/permissions.ts` | Rewritten as `packages/shared/src/auth.ts` (`ROLE_PERMISSIONS`, deny-by-default). |
| `src/modules/auth/*` | Ported: login flow, lockout idea, logout, me, change-password. Session listing/revocation and profile edit removed (no sessions table; not in §11.2). |
| `src/modules/users/*` | Ported: create, list, self/last-admin protections. Ban/unban → `is_active`; role change → `PATCH /users/:id`; delete removed (deactivate instead, keeps audit trail). |
| `src/lib/auth.ts`, `src/lib/redis.ts`, `src/middlewares/rate-limit.ts`, `src/types/express.d.ts` | Replaced (jose, rate-limiter-flexible, typed principal). |
| `src/middlewares/error-handler.ts`, `src/utils/*` | Rewritten into `http/middleware/error-handler.ts`, `lib/errors.ts`, `http/respond.ts`, `http/middleware/validate.ts`. |
| `src/db/*`, `drizzle/*` | Rewritten for the §10 schema; old migration deleted (fresh database). |
| `src/scripts/seed-admin.ts` | Rewritten into `migrate.ts` + `infrastructure/database/seed.ts` (never resets an existing password). |
| Root `Dockerfile`, `docker-compose.yml`, `yaak/`, `nodemon.json` | Deleted (superseded). |
