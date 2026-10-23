import type { Request } from 'express';
import type { Redis } from 'ioredis';
import { idempotency } from '../../http/middleware/idempotency';
import { clientIp, createLimiter, rateLimit } from '../../http/middleware/rate-limit';
import type { SecureRouter } from '../../http/secure-router';
import type { Logger } from '../../infrastructure/logger';
import type { MonitoringController } from './monitoring.controller';
import { fetchLiveBody, runsQuery, staticIngestBody } from './monitoring.schemas';

/** Per principal; anonymous (demo) callers are keyed by IP so one client cannot starve the rest. */
const principalKey = (req: Request) =>
  req.principal.kind === 'anonymous' ? `anon:${clientIp(req)}` : `${req.principal.kind}:${req.principal.id}`;

export const registerMonitoringRoutes = (
  api: SecureRouter,
  root: SecureRouter,
  controller: MonitoringController,
  deps: { redis: Redis; logger: Logger },
): void => {
  const ingestLimiter = createLimiter(deps.redis, { keyPrefix: 'ingest', points: 120, duration: 60 });
  const ingestGuards = (route: string) => [
    rateLimit({ limiter: ingestLimiter, points: 120, key: principalKey, logger: deps.logger }),
    idempotency(deps.redis, deps.logger, route),
  ];

  // Assignment path (root alias) and the versioned path share one handler and one idempotency scope.
  for (const [router, path] of [
    [root, '/monitor'],
    [api, '/monitor'],
  ] as const) {
    router.route({
      method: 'post',
      path,
      access: { permission: 'telemetry:ingest' },
      middleware: ingestGuards('monitor'),
      handler: (req, res) => controller.ingest(req, res),
    });
  }

  api.route({
    method: 'post',
    path: '/monitor/static',
    access: { permission: 'telemetry:ingest', userOnly: true },
    middleware: ingestGuards('monitor-static'),
    schemas: { body: staticIngestBody },
    handler: (req, res, { body }) => controller.ingestStatic(req, res, body.file),
  });

  api.route({
    method: 'get',
    path: '/monitor/static/files',
    access: { permission: 'alerts:read' },
    handler: (req, res) => controller.listStaticFiles(req, res),
  });

  api.route({
    method: 'post',
    path: '/monitor/fetch-live',
    access: { permission: 'simulator:control' },
    middleware: ingestGuards('monitor-fetch-live'),
    schemas: { body: fetchLiveBody },
    handler: (req, res, { body }) => controller.fetchLive(req, res, body.count),
  });

  api.route({
    method: 'get',
    path: '/monitor/runs',
    access: { permission: 'alerts:read' },
    schemas: { query: runsQuery },
    handler: (req, res, { query }) => controller.listRuns(req, res, query.limit),
  });
};
