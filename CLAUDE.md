# CLAUDE.md — Intelligent API Monitor

**Source of truth: `docs/PROJECT_SPEC.md`.** Read it completely before changing code. If this file and the spec disagree, the spec wins — then fix this file.

## What this project is

A Node.js/Express 5 + TypeScript monorepo that ingests API response telemetry (`POST /monitor`), detects anomalies with a pure deterministic engine, enriches alerts with an LLM (provider failover + deterministic template fallback), stores everything in PostgreSQL, serves active alerts at `GET /alerts`, streams updates over SSE and emails critical incidents. Runs with one command: `docker compose up --build`.

**Scope: backend only.** The UI will be a separate Next.js app built later; this build delivers its API contract (spec §15). Do not create `apps/web`, React code or nginx config.

**Auth: reuse the owner's existing Express role-based auth module** (spec §12.1) — audit it, harden it, port it into `modules/auth` + `modules/users`. Only `ADMIN` has permissions in this build; `MANAGER` exists but is denied everything except `/auth/me`.

Apps: `apps/monitor-api` (API :3001 + worker), `apps/telemetry-simulator` (:4400). Shared types: `packages/shared` (`@apimon/shared`). API docs: `http://localhost:3001/docs`.

## Commands

```bash
npm install
npm run dev:infra          # postgres, redis, mailpit in Docker
npm run dev                # api + worker + simulator on the host (watch mode)
npm run lint
npm run typecheck
npm run test:unit          # no infrastructure needed
npm run test:integration   # needs dev:infra
npm run test:contract      # routes ↔ openapi.yaml, CORS, response shapes
npm test
npm run db:generate        # after editing the Drizzle schema
npm run db:migrate
docker compose up --build  # full stack
npm run smoke              # end-to-end check against the running stack
```

## How to work

- Execute the phases in spec §19 **in order**. Tick each checkbox in the spec when done so a new session can resume with "Continue from Phase N".
- After every phase: `npm run lint && npm run typecheck && npm run test:unit`, then the phase's own gate. Fix every failure before moving on. Commit with a conventional message (`feat(monitoring): …`, `fix(auth): …`).
- Existing code is ported into the target layout with `git mv`; keep what works, rewrite what violates the spec, delete what is superseded. Record non-obvious choices in `docs/DECISIONS.md`.
- Ambiguity: pick the simpler option consistent with the spec, write it in `docs/DECISIONS.md`, keep going. Stop and report only if a gate cannot pass after genuine attempts, or a step is destructive and irreversible.
- **Never** weaken, skip, or delete a test to make it pass. **Never** stub production behaviour to satisfy a gate. A test that fails because the spec is wrong → note it in `docs/DECISIONS.md` and fix both.
- Before using any library named in spec §21 (Express 5, Zod v4, Drizzle, BullMQ, ioredis, rate-limiter-flexible, jose, cors, helmet, swagger-ui-express, LLM SDKs), check the installed version's type definitions or official docs. Do not write API calls from memory.

## Architecture rules

- Layering: `routes → controller → service → repository`. Controllers parse/respond only. SQL lives only in repositories (or `infrastructure/database`). Services never touch `req`/`res`.
- `modules/monitoring/anomaly-engine/*` is pure: no I/O, no `Date.now()`, no randomness, no imports from infrastructure.
- Dependencies are wired in `src/container.ts`; `createApp(container)` never calls `listen()` (tests build the app with test doubles).
- Every route is declared through `http/secure-router.ts` with a required `access` option. No route without explicit access. Authorization is only ever `requirePermission(...)` against `ROLE_PERMISSIONS` — never `role === 'ADMIN'` in routes or services.
- Config only through `config/env.ts`. No `process.env` anywhere else (scripts excepted).
- Logging only through the pino logger. No `console.log` in app code. Never log request bodies, passwords, tokens, cookies, or keys.
- Zod at every boundary (HTTP input, env, LLM output, job data). Auth and user bodies use strict objects.
- External JSON is `snake_case`; TypeScript is `camelCase`; mapping in `*.mapper.ts`.
- Errors: throw `AppError` subclasses; the central error handler formats responses. Never hand-write 500 responses.
- TypeScript strict; no `any`; no non-null assertions without a comment explaining why.

## Naming

- Backend files: kebab-case with a role suffix — `alerts.routes.ts`, `alerts.controller.ts`, `alerts.service.ts`, `alerts.repository.ts`, `alerts.schemas.ts`, `alerts.mapper.ts`, `ai-enrichment.processor.ts`.
- DB: snake_case tables and columns; enums upper-case values.
- Env vars: UPPER_SNAKE_CASE, documented in `.env.example`.

## Definition of done (every feature)

1. Behaviour matches the spec section it implements.
2. Unit tests for logic, integration tests for HTTP/DB behaviour, all green.
3. Lint and typecheck clean.
4. Errors are typed and mapped; logs are structured and redacted.
5. Docs updated if behaviour, config, or endpoints changed (`README.md`, `docs/openapi.yaml`, `docs/api.http`, `.env.example`) — the contract tests fail if a route is missing from `docs/openapi.yaml`.
6. Works inside Docker Compose, not only on the host.
