# @apimon/frontend

Next.js dashboard for the monitor API. It proxies `/api/v1/*` and `/health*` to the backend (`INTERNAL_API_URL`, default `http://localhost:3001`); the live alert stream connects to `NEXT_PUBLIC_API_URL`.

```bash
npm run dev:frontend          # from the repository root, http://localhost:3000
npx shadcn@latest add button  # from this folder, adds a shadcn/ui component
```

API contract: [`docs/FRONTEND_INTEGRATION.md`](../../docs/FRONTEND_INTEGRATION.md).
