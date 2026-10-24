# Frontend integration guide (Next.js)

This backend is built to be consumed by a Next.js app that will live in `apps/frontend` later. Nothing here requires
backend changes: the contract below is stable and enforced by contract tests (`npm run test:contract`).

- **Contract:** `docs/openapi.yaml` (OpenAPI 3.1), served at `http://localhost:3001/docs/openapi.json`; Swagger UI at `/docs`.
- **Envelope:** `{ success: true, data, meta? }` or `{ success: false, error: { code, message, details?, request_id } }`.
- **Conventions:** JSON is `snake_case`; timestamps are ISO-8601 UTC strings (format them in the browser); ids are UUIDs;
  lists return `meta: { total, limit, offset }`; error `code` values are a closed enum (`ErrorCode`).
- Breaking changes would ship under a new path version (`/api/v2`).

## 1. Connecting

### Recommended: Next.js rewrites (one origin)

The browser only talks to the Next.js origin, so the refresh cookie is first-party and CORS is not involved.

```ts
// apps/frontend/next.config.ts
import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

const config: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};
export default config;
```

The API checks the `Origin` header on `/auth/refresh` and `/auth/logout`. Behind rewrites the browser sends the Next.js
origin (`http://localhost:3000`), which is the default `CORS_ALLOWED_ORIGINS`, so this works out of the box.

### Alternative: call the API origin directly

```ts
fetch('http://localhost:3001/api/v1/alerts', {
  credentials: 'include',
  headers: { Authorization: `Bearer ${token}` },
});
```

- `localhost:3000` → `localhost:3001` is cross-origin but **same-site**, so the `SameSite=Strict` refresh cookie is still sent
  (with `credentials: 'include'`).
- If the frontend and API end up on different _sites_ in production, set `COOKIE_SAME_SITE=none` and `COOKIE_SECURE=true`
  (the API refuses `none` without `Secure`), and add the frontend origin to `CORS_ALLOWED_ORIGINS`.

### CORS as configured

| Setting                  | Value                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Allowed origins          | exact list from `CORS_ALLOWED_ORIGINS` (never `*`)                                                      |
| Credentials              | `true`                                                                                                  |
| Methods                  | `GET, POST, PATCH, OPTIONS`                                                                             |
| Allowed request headers  | `Content-Type, Authorization, Idempotency-Key, X-Request-Id`                                            |
| Exposed response headers | `X-Request-Id, Retry-After, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Idempotent-Replayed` |
| Preflight cache          | 600 s                                                                                                   |

`x-ingest-key` is deliberately **not** an allowed header: it is a machine credential and a browser must never send it.
A disallowed origin simply gets no CORS headers (the browser blocks the response); the server never errors on it.

## 2. Auth flow

1. `POST /api/v1/auth/login` with `{ email, password }` → `{ access_token, token_type, expires_in, user, permissions }`.
   Keep `access_token` **in memory only** (React context / store). Never `localStorage` or `sessionStorage`.
   The server sets the refresh cookie `apimon_rt` (`HttpOnly`, `SameSite`, `Path=/api/v1/auth`).
2. On app load, call `POST /api/v1/auth/refresh` to restore the session from the cookie (401 → show the login page).
3. On `401 TOKEN_EXPIRED`, run **one shared refresh** (single flight) and retry the original request once.
   On `401 REFRESH_RACE`, another tab rotated the cookie first: wait 300 ms and refresh once more.
   If refresh fails, go to the login page.
4. `GET /api/v1/auth/me` → `{ user, permissions }`. Show or hide UI by **permission**, never by role name.
   The API enforces everything regardless. Only `ADMIN` has permissions today; `MANAGER` users get `permissions: []`.
5. Next.js `middleware.ts` cannot see the in-memory token, so route guarding happens client-side.

Login is rate limited (20 attempts / 15 min per IP; 5 consecutive failures block an email for 15 min). Show the
`Retry-After` value to the user on `429`. Every failure returns the same `INVALID_CREDENTIALS` message.

### Fetch wrapper with single-flight refresh

```ts
// apps/frontend/lib/api.ts
type ApiError = { code: string; message: string; details?: unknown; request_id: string };
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function refreshOnce(): Promise<boolean> {
  const attempt = async () => fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
  let res = await attempt();
  if (res.status === 401 && (await res.clone().json()).error?.code === 'REFRESH_RACE') {
    await sleep(300); // another tab won; the shared cookie now holds the new token
    res = await attempt();
  }
  if (!res.ok) {
    setAccessToken(null);
    return false;
  }
  setAccessToken((await res.json()).data.access_token);
  return true;
}

/** All concurrent callers share one refresh. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= refreshOnce().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<{ data: T; meta?: unknown }> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'include' });
  const body = await res.json().catch(() => null);

  if (res.status === 401 && !retried && body?.error?.code === 'TOKEN_EXPIRED') {
    if (await refreshSession()) return api<T>(path, init, true);
  }
  if (!res.ok || !body?.success) {
    throw new ApiRequestError(
      res.status,
      body?.error ?? { code: 'INTERNAL_ERROR', message: res.statusText, request_id: '' },
    );
  }
  return body;
}

export async function login(email: string, password: string) {
  const res = await fetch('/api/v1/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new ApiRequestError(res.status, body.error);
  setAccessToken(body.data.access_token);
  return body.data as { user: { id: string; email: string; role: string }; permissions: string[] };
}

export async function logout() {
  await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
  setAccessToken(null);
}
```

## 3. Realtime (Server-Sent Events)

`EventSource` cannot send headers, so the client exchanges its token for a **single-use, 60-second ticket** and opens the
stream **directly against the API origin** (not through rewrites — dev-server rewrites can buffer streams). The API
origin already allows the frontend origin via CORS.

- `POST /api/v1/alerts/stream-ticket` → `{ ticket, expires_in: 60 }`
- `GET  {API_URL}/api/v1/alerts/stream?ticket=…`

Events (each frame is `id`, `event`, `data` JSON):

| Event                                                | Payload                  | What to do                                                                 |
| ---------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `ready`                                              | `{ client_id }`          | Refetch the lists you show (you may have missed events while disconnected) |
| `alert.created` / `alert.updated` / `alert.resolved` | `{ alert: Alert }`       | Upsert the alert in your cache                                             |
| `alerts.invalidated`                                 | `{ reason, count }`      | A bulk change: refetch lists                                               |
| `monitor.run.completed`                              | `{ run: MonitorRun }`    | Update ingestion views                                                     |
| `shutdown`                                           | `{ reconnect_after_ms }` | The server is restarting: reconnect                                        |

Tickets are single-use, so the browser's automatic reconnect cannot work. On `error`, close the stream, get a new ticket
and reconnect with backoff (1 s → 30 s). Limits: 5 streams per user (429 beyond that).

```tsx
// apps/frontend/hooks/use-alert-stream.ts
'use client';
import { useEffect } from 'react';
import { api } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const EVENTS = [
  'alert.created',
  'alert.updated',
  'alert.resolved',
  'alerts.invalidated',
  'monitor.run.completed',
] as const;

export function useAlertStream(onEvent: (name: (typeof EVENTS)[number] | 'ready', data: unknown) => void) {
  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1_000;
    let stopped = false;

    const connect = async () => {
      try {
        const { data } = await api<{ ticket: string }>('/alerts/stream-ticket', { method: 'POST' });
        if (stopped) return;
        source = new EventSource(`${API_URL}/api/v1/alerts/stream?ticket=${encodeURIComponent(data.ticket)}`);
        source.addEventListener('ready', () => {
          delay = 1_000;
          onEvent('ready', null);
        });
        for (const name of EVENTS)
          source.addEventListener(name, (e) => onEvent(name, JSON.parse((e as MessageEvent).data)));
        source.addEventListener('shutdown', () => reconnect());
        source.onerror = () => reconnect();
      } catch {
        reconnect();
      }
    };

    const reconnect = () => {
      source?.close();
      source = null;
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30_000);
    };

    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [onEvent]);
}
```

## 4. Endpoints per future screen

(Paths are under `/api/v1` unless they start with `/alerts` or `/monitor` at the root.)

| Screen                       | Endpoints                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login / session              | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`                                                                |
| Dashboard                    | `GET /alerts/summary`, `GET /apis`, `GET /alerts?limit=10`, SSE                                                                                                            |
| Alerts list + detail         | `GET /alerts` (`status`, `severity`, `api_name`, `anomaly_type`, `sort`, `limit`, `offset`), `GET /alerts/:id`, `PATCH /alerts/:id/resolve`, `POST /alerts/:id/regenerate` |
| Ingest (paste / upload JSON) | `POST /monitor`, `GET /monitor/static/files`, `POST /monitor/static`, `GET /monitor/runs`                                                                                  |
| Simulator                    | `GET /simulator/scenarios`, `POST /simulator/scenarios/:name`, `POST /simulator/stream/start`, `POST /simulator/stream/stop`, `GET /simulator/stream/status`               |
| APIs + thresholds            | `GET /apis`, `PATCH /apis/:name/thresholds`                                                                                                                                |
| Users + audit                | `GET /users`, `POST /users`, `PATCH /users/:id`, `GET /audit-logs`                                                                                                         |

Permission needed per action (use `permissions` from `/auth/me` to show/hide controls):

| Permission                             | Unlocks                                                             |
| -------------------------------------- | ------------------------------------------------------------------- |
| `alerts:read`                          | alert lists, detail, summary, runs, sample file list, stream ticket |
| `apis:read`                            | monitored APIs                                                      |
| `telemetry:ingest`                     | `POST /monitor`, `POST /monitor/static`                             |
| `alerts:resolve` / `alerts:regenerate` | resolve / regenerate buttons                                        |
| `simulator:control`                    | simulator screen, fetch-live                                        |
| `apis:configure`                       | threshold editing                                                   |
| `users:manage` / `audit:read`          | user admin / audit trail                                            |

## 5. Types

Generate TypeScript types from the contract:

```bash
npx openapi-typescript http://localhost:3001/docs/openapi.json -o apps/frontend/lib/api-types.ts
```

Once the app lives in this monorepo as `apps/frontend`, it can also import `@apimon/shared` (anomaly codes, labels and
descriptions, permissions, realtime event names and payload types). Remember to add its `package.json` to the
`manifests` stage of the Dockerfiles.

## 6. UI rules that matter for security

- Render `alert_message`, `probable_cause` and `recommended_action` **as text** (`{alert.alert_message}` in JSX), never with
  `dangerouslySetInnerHTML`: the text may come from an LLM.
- Never send `x-ingest-key` from the browser and never put tokens in URLs (except the single-use SSE ticket).
- Send an `Idempotency-Key` (UUID) with user-initiated ingestion so a double-click or retry cannot double-count.
- Show `error.request_id` in error toasts: it matches the `request_id` in the API logs.

## 7. Where the frontend lives

The dashboard is `apps/frontend` (npm workspace `@apimon/frontend`, Next.js). It proxies `/api/v1/*` and `/health*` to
the backend through Next.js rewrites, so the browser stays same-origin and the refresh cookie works; only the SSE stream
connects to `NEXT_PUBLIC_API_URL` directly. Run it with `npm run dev:frontend` (or `npm run dev` for everything) and in
Docker as the `frontend` service.
