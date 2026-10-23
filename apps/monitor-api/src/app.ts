import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Request } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Container } from './container';
import { createAuthenticate } from './http/middleware/authenticate';
import { errorHandler } from './http/middleware/error-handler';
import { notFound } from './http/middleware/not-found';
import { clientIp, createLimiter, rateLimit } from './http/middleware/rate-limit';
import { requestContext } from './http/middleware/request-context';
import { RouteRegistry, SecureRouter } from './http/secure-router';
import { registerAuditRoutes } from './modules/audit/audit.routes';
import { registerAuthRoutes } from './modules/auth/auth.routes';
import { docsHelmet, loadOpenapiDocument, registerDocsRoutes } from './modules/docs/docs.routes';
import { registerHealthRoutes } from './modules/health/health.routes';
import { registerMetaRoutes } from './modules/meta/meta.routes';
import { registerUsersRoutes } from './modules/users/users.routes';

export const API_PREFIX = '/api/v1';

/** CORS for the future Next.js client (§15.1). x-ingest-key is deliberately not allowed: browsers must never send it. */
export const CORS_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'];
export const CORS_EXPOSED_HEADERS = [
  'X-Request-Id',
  'Retry-After',
  'RateLimit-Limit',
  'RateLimit-Remaining',
  'RateLimit-Reset',
  'Idempotent-Replayed',
];

/** Never logs bodies; masks the single-use SSE ticket in URLs. */
const maskUrl = (url: string) => url.replace(/([?&]ticket=)[^&]*/gi, '$1[REDACTED]');

export interface AppOptions {
  /** Defaults to docs/openapi.yaml; tests may inject a parsed document. */
  openapiDocument?: Record<string, unknown>;
}

/** Builds the Express app. Never calls listen() — tests drive it with Supertest (§11). */
export const createApp = (
  container: Container,
  options: AppOptions = {},
): { app: Express; registry: RouteRegistry } => {
  const { env, logger, redis } = container;
  const app = express();
  const registry = new RouteRegistry();

  // §16.3 order.
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('query parser', 'simple');
  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).requestId,
      customProps: (req) => ({ request_id: (req as Request).requestId }),
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      autoLogging: { ignore: (req) => req.url.startsWith('/health') },
      serializers: {
        req: (req: {
          id: unknown;
          method: string;
          url: string;
          headers: Record<string, unknown>;
          remoteAddress?: string;
        }) => ({
          id: req.id,
          method: req.method,
          url: maskUrl(req.url),
          headers: req.headers,
          remoteAddress: req.remoteAddress,
        }),
      },
    }),
  );
  const defaultHelmet = helmet();
  app.use((req, res, next) =>
    (req.path === '/docs' || req.path.startsWith('/docs/') ? docsHelmet : defaultHelmet)(req, res, next),
  );
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, origin !== undefined && env.CORS_ALLOWED_ORIGINS.includes(origin) ? origin : false),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowedHeaders: CORS_ALLOWED_HEADERS,
      exposedHeaders: CORS_EXPOSED_HEADERS,
      maxAge: 600,
    }),
  );
  // strict:false so non-object JSON (e.g. "x") reaches the envelope parser → INVALID_PAYLOAD, not INVALID_JSON.
  app.use(express.json({ limit: env.MAX_BODY_SIZE, strict: false }));
  app.use(cookieParser());
  app.use(
    createAuthenticate({
      tokens: container.tokens,
      userCache: container.userCache,
      ingestApiKey: env.INGEST_API_KEY,
      demoMode: env.DEMO_MODE,
    }),
  );
  const globalLimiter = createLimiter(redis, { keyPrefix: 'global:ip', points: 300, duration: 60 });
  app.use(
    rateLimit({
      limiter: globalLimiter,
      points: 300,
      key: clientIp,
      skip: (req) => req.path.startsWith('/health/') || req.path === `${API_PREFIX}/alerts/stream`,
      logger,
    }),
  );

  // Routes.
  const root = new SecureRouter(registry);
  const api = new SecureRouter(registry, API_PREFIX);

  registerHealthRoutes(root, container.health);
  registerDocsRoutes(app, root, options.openapiDocument ?? loadOpenapiDocument());
  registerMetaRoutes(api, env);
  registerAuthRoutes(api, container.authController, { env, redis, logger });
  registerUsersRoutes(api, container.usersController);
  registerAuditRoutes(api, container.audit);

  app.use(root.router);
  app.use(API_PREFIX, api.router);

  app.use(notFound);
  app.use(errorHandler);

  return { app, registry };
};
