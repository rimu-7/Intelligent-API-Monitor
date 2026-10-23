# API Monitoring System

Express 5 + TypeScript API with role-based access control.

- **Auth:** [Better Auth](https://better-auth.com), used as a library. Its HTTP handler is not mounted, so there is no public sign-up. Login is the only public endpoint.
- **Database:** Supabase Postgres via [Drizzle ORM](https://orm.drizzle.team).
- **Roles:** `admin` (full control) and `manager` (limited, granted by admin).

## Roles

| Action | admin | manager |
| --- | :---: | :---: |
| Log in, log out, view own profile | ✅ | ✅ |
| List / view users | ✅ all users | ✅ managers only |
| Create admins and managers | ✅ | ❌ |
| Change roles, ban / unban, delete | ✅ | ❌ |

Permissions live in [src/lib/permissions.ts](src/lib/permissions.ts). To give managers more access, add actions to the `manager` role there.

Built-in safety rules:

- Admins cannot change their own role, ban themselves or delete themselves.
- The last active admin can never be demoted, banned or deleted.
- Banning a user signs them out everywhere immediately.

## Getting started

```bash
npm install
cp .env.example .env        # then fill in the values
npm run db:migrate          # create tables in Supabase
npm run db:seed             # create the first admin from SEED_ADMIN_* values
npm run dev                 # http://localhost:3001
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Start with auto-reload |
| `npm run build` / `npm start` | Compile to `dist/` and run in production mode |
| `npm run typecheck` | Type-check without emitting |
| `npm run db:generate` | Create a new migration after editing `src/db/schema` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Browse the database with Drizzle Studio |
| `npm run db:seed` | Create the first admin. Safe to run more than once. |

> **Supabase:** `DATABASE_URL` uses the transaction pooler (port 6543). If migrations fail with prepared statement errors, set `DATABASE_URL_DIRECT` to the session pooler URL (same URL, port 5432).
>
> RLS is enabled on every auth table with no policies, so Supabase's public REST API cannot read them. The backend connects as `postgres`, which bypasses RLS.

## API

Base URL: `http://localhost:3001/api/v1`

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/auth/login` | Public (rate limited: 10 failed tries per 15 min) |
| `POST` | `/auth/logout` | Signed in |
| `GET` | `/auth/me` | Signed in |
| `POST` | `/users` | admin |
| `GET` | `/users?page=&limit=&role=&search=` | admin, manager (managers see managers only) |
| `GET` | `/users/:id` | admin, manager (managers see managers only) |
| `PATCH` | `/users/:id/role` | admin |
| `POST` | `/users/:id/ban` | admin |
| `POST` | `/users/:id/unban` | admin |
| `DELETE` | `/users/:id` | admin |

Login sets an HttpOnly session cookie and also returns a `token`. Send it as `Authorization: Bearer <token>` if you prefer headers to cookies.

Responses share one shape:

```jsonc
{ "success": true, "data": { ... }, "meta": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [ ... ] } }
```

### Yaak

1. In Yaak, choose **Import** and pick [yaak/api-monitoring-system.postman_collection.json](yaak/api-monitoring-system.postman_collection.json).
2. Run **Auth → Login (admin)**. Yaak's cookie jar keeps the session for the other requests.
3. To work on one user, copy their `id` into the `userId` variable.

## Project structure

```
src/
├── config/env.ts            # Validated environment variables (zod)
├── db/
│   ├── client.ts            # postgres.js + Drizzle client
│   └── schema/              # Drizzle tables (Better Auth core + admin + username)
├── lib/
│   ├── auth.ts              # Better Auth instance
│   ├── permissions.ts       # Roles and permissions
│   └── logger.ts            # pino logger (redacts cookies, tokens, passwords)
├── middlewares/             # authenticate, authorize, rate limit, error handler
├── modules/
│   ├── auth/                # login, logout, me
│   └── users/               # user management (routes → controller → service → repository)
├── routes/index.ts          # Mounts module routers under /api/v1
├── scripts/seed-admin.ts    # First admin seed
├── types/express.d.ts       # req.auth typing
├── utils/                   # ApiError, response helpers, validation
├── app.ts                   # Express app (helmet, cors, compression, logging)
└── server.ts                # HTTP server + graceful shutdown
drizzle/                     # SQL migrations
yaak/                        # Request collection for Yaak
```
