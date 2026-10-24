# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app

FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/simulator/package.json apps/simulator/
COPY apps/frontend/package.json apps/frontend/

FROM manifests AS deps
RUN --mount=type=cache,target=/root/.npm npm ci --workspace @apimon/backend --include-workspace-root

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/backend apps/backend
COPY docs/openapi.yaml docs/openapi.yaml
RUN npm run build -w @apimon/backend

FROM manifests AS prod-deps
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace @apimon/backend \
 && mkdir -p apps/backend/node_modules

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build --chown=node:node /app/apps/backend/package.json ./apps/backend/
COPY --from=build --chown=node:node /app/apps/backend/dist ./apps/backend/dist
COPY --from=build --chown=node:node /app/apps/backend/drizzle ./apps/backend/drizzle
COPY --from=build --chown=node:node /app/docs/openapi.yaml ./apps/backend/openapi.yaml
WORKDIR /app/apps/backend
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
