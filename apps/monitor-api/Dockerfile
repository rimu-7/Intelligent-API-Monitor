# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app

FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/monitor-api/package.json apps/monitor-api/
COPY apps/telemetry-simulator/package.json apps/telemetry-simulator/
# when the Next.js app is added as apps/web, add its package.json here too

FROM manifests AS deps
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/monitor-api apps/monitor-api
COPY docs/openapi.yaml docs/openapi.yaml
RUN npm run build -w @apimon/monitor-api

FROM manifests AS prod-deps
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace @apimon/monitor-api \
 && mkdir -p apps/monitor-api/node_modules

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/apps/monitor-api/node_modules ./apps/monitor-api/node_modules
COPY --from=build --chown=node:node /app/apps/monitor-api/package.json ./apps/monitor-api/
COPY --from=build --chown=node:node /app/apps/monitor-api/dist ./apps/monitor-api/dist
COPY --from=build --chown=node:node /app/apps/monitor-api/drizzle ./apps/monitor-api/drizzle
COPY --from=build --chown=node:node /app/docs/openapi.yaml ./apps/monitor-api/openapi.yaml
WORKDIR /app/apps/monitor-api
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
