# syntax=docker/dockerfile:1

# ─── deps: install once, shared by dev and build ────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ─── dev: hot reload (optional: build with --target dev) ────────────────────
FROM node:22-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development PORT=3000 HOSTNAME=0.0.0.0 WATCHPACK_POLLING=true
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

# ─── builder: production build (standalone output) ──────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
# Baked in at build time: the proxy target (server side) and the SSE origin (browser side).
ARG INTERNAL_API_URL=http://monitor-api:3001
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV INTERNAL_API_URL=$INTERNAL_API_URL NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ─── runner: minimal production image ───────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", "server.js"]
