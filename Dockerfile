# Development stage with nodemon & tsx live-reload
FROM node:22-alpine AS dev

WORKDIR /app

ENV NODE_ENV=development
ENV PORT=3001

RUN apk add --no-cache curl postgresql-client

COPY express-backend/package*.json ./
RUN npm install

COPY express-backend ./

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=10s \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["npm", "run", "dev"]

# Multi-stage production build for Express Auth & RBAC API
FROM node:22-alpine AS builder

WORKDIR /app

COPY express-backend/package*.json ./
RUN npm ci

COPY express-backend ./
RUN npm run build

# Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

RUN apk add --no-cache curl postgresql-client

COPY express-backend/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=10s \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "dist/server.js"]
