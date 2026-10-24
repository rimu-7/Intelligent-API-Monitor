# Intelligent API Monitor

A modern, production-grade telemetry monitoring platform with deterministic anomaly detection, BullMQ background queues, AI incident analysis (Mistral / Gemini / OpenAI), realtime SSE streams, and an interactive Next.js dashboard.

---

## ⚡ One-Line Quick Start

Set up your environment and run all services in Docker with a single command:

```bash
cp -n .env.example .env && docker compose up --build -d
```

> **Note:** Run `docker compose ps` to verify all services are running and healthy.

---

## 🌐 Services & Ports

| Service           | URL                                            | Description                                    |
| :---------------- | :--------------------------------------------- | :--------------------------------------------- |
| **Web Dashboard** | [http://localhost:3000](http://localhost:3000) | Next.js frontend with shadcn/ui dashboard      |
| **Monitor API**   | [http://localhost:3001](http://localhost:3001) | Express REST API & Realtime SSE                |
| **Simulator**     | [http://localhost:4400](http://localhost:4400) | Synthetic telemetry & burst scenario generator |
| **PostgreSQL**    | `localhost:5432`                               | Relational storage (`apimon` database)         |
| **Redis**         | `localhost:6379`                               | BullMQ queues, caching, and pub/sub            |

### Default Admin Credentials

- **Email:** `admin@example.com`
- **Password:** `Admin@123456!`

---

## 🚀 Setup & Execution Guide

### Prerequisites

- **Docker** & **Docker Compose v2+** (recommended for running everything)
- **Node.js 22.18+** and **npm** (only needed for host-mode development)

---

### Option A: Run via Docker (Recommended)

1. **Configure Environment:**

   ```bash
   cp -n .env.example .env
   ```

   _(Optional)_ Add your `MISTRAL_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` in `.env` for AI features.

2. **Launch All Services:**

   ```bash
   docker compose up --build -d
   ```

3. **Useful Docker Commands:**
   ```bash
   docker compose ps         # View running status
   docker compose logs -f    # Tail live logs for all containers
   docker compose down       # Stop and remove containers
   ```

---

### Option B: Local Host Development

If you prefer hot-reloading for local code changes:

1. **Install dependencies and create `.env`** (one npm workspace covers every app):

   ```bash
   npm run setup
   ```

2. **Start Postgres and Redis, then run migrations:**

   ```bash
   npm run dev:infra
   npm run db:migrate
   ```

3. **Start everything with hot reload** (backend, worker, simulator, frontend):
   ```bash
   npm run dev
   ```
   Or one part at a time: `npm run dev:backend`, `npm run dev:frontend`, `npm run dev:simulator`.

---

## 🛠 Features & Capabilities

- **High-Throughput Ingestion:** `POST /monitor` handles batches up to 1,000 items with atomic transactional writes.
- **8-Rule Anomaly Detection:** Real-time deterministic detection of server errors (`5xx`), auth failures (`401`/`403`), client errors (`4xx`), latency spikes, zero/missing records, and invalid metrics.
- **Incident Deduplication:** Repeating issues update occurrence counters instead of cluttering the board; escalates `WARNING` → `CRITICAL` automatically.
- **AI-Powered Root Cause Analysis:** Enriches incidents via Mistral (`ministral-8b-latest`), OpenAI, or Gemini with automatic fallback to deterministic templates.
- **Live Realtime Feed:** Server-Sent Events (SSE) stream new anomalies and updates instantly to the UI.
- **Alert Notifications:** Configurable SMTP email alerts for critical incidents.
- **Synthetic Simulator:** 12 built-in outage scenarios and continuous traffic streaming for end-to-end testing.

---

## 📁 Repository Structure

```
├── apps/
│   ├── backend/        # @apimon/backend — Express 5 API, anomaly engine, BullMQ worker, migrations
│   ├── frontend/       # @apimon/frontend — Next.js dashboard (shadcn/ui + Tailwind CSS)
│   └── simulator/      # @apimon/simulator — synthetic telemetry and outage scenarios
├── packages/
│   └── shared/         # @apimon/shared — types and constants shared by the apps
├── data/samples/       # telemetry sample payloads
├── docker/postgres/    # Postgres init scripts
├── docs/               # spec, architecture, decisions, OpenAPI, API client collections
├── scripts/            # smoke test and file ingestion helpers
├── compose.yaml        # full stack: postgres, redis, migrate, backend, worker, simulator, frontend
└── .env.example        # environment template
```

Each app has its own `Dockerfile`, built from the repository root. One `package-lock.json` covers all workspaces.

## ✅ Checks

```bash
npm run lint && npm run typecheck && npm run test:unit
npm run test:integration && npm run test:contract   # needs npm run dev:infra
npm run smoke                                        # against the running stack
```
