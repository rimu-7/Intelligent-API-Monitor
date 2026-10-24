# syntax=docker/dockerfile:1.7
# Build context: repository root (npm workspaces share one lockfile).
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/simulator/package.json apps/simulator/
COPY apps/frontend/package.json apps/frontend/
RUN --mount=type=cache,target=/root/.npm npm ci --workspace @apimon/frontend

FROM deps AS build
# Baked in at build time: the proxy target (server side) and the SSE origin (browser side).
ARG INTERNAL_API_URL=http://backend:3001
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV INTERNAL_API_URL=$INTERNAL_API_URL NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
COPY apps/frontend apps/frontend
RUN npm run build -w @apimon/frontend

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=build --chown=node:node /app/apps/frontend/public ./apps/frontend/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", "apps/frontend/server.js"]
