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
RUN --mount=type=cache,target=/root/.npm npm ci --workspace @apimon/simulator --include-workspace-root

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/simulator apps/simulator
RUN npm run build -w @apimon/simulator

FROM manifests AS prod-deps
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace @apimon/simulator \
 && mkdir -p apps/simulator/node_modules

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/apps/simulator/node_modules ./apps/simulator/node_modules
COPY --from=build --chown=node:node /app/apps/simulator/package.json ./apps/simulator/
COPY --from=build --chown=node:node /app/apps/simulator/dist ./apps/simulator/dist
WORKDIR /app/apps/simulator
USER node
EXPOSE 4400
CMD ["node", "dist/server.js"]
