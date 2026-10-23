# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app

FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/monitor-api/package.json apps/monitor-api/
COPY apps/telemetry-simulator/package.json apps/telemetry-simulator/

FROM manifests AS deps
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/telemetry-simulator apps/telemetry-simulator
RUN npm run build -w @apimon/telemetry-simulator

FROM manifests AS prod-deps
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace @apimon/telemetry-simulator \
 && mkdir -p apps/telemetry-simulator/node_modules

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/apps/telemetry-simulator/node_modules ./apps/telemetry-simulator/node_modules
COPY --from=build --chown=node:node /app/apps/telemetry-simulator/package.json ./apps/telemetry-simulator/
COPY --from=build --chown=node:node /app/apps/telemetry-simulator/dist ./apps/telemetry-simulator/dist
WORKDIR /app/apps/telemetry-simulator
USER node
EXPOSE 4400
CMD ["node", "dist/server.js"]
