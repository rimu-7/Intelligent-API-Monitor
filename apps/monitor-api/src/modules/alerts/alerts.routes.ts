import type { Redis } from 'ioredis';
import { createLimiter, rateLimit } from '../../http/middleware/rate-limit';
import type { SecureRouter } from '../../http/secure-router';
import type { Logger } from '../../infrastructure/logger';
import type { AlertsController } from './alerts.controller';
import { alertIdParams, listAlertsQuery, resolveAlertBody } from './alerts.schemas';

export const registerAlertsRoutes = (
  api: SecureRouter,
  root: SecureRouter,
  controller: AlertsController,
  deps: { redis: Redis; logger: Logger },
): void => {
  // Assignment path (root alias) and the versioned path share one handler.
  for (const router of [root, api]) {
    router.route({
      method: 'get',
      path: '/alerts',
      access: { permission: 'alerts:read' },
      schemas: { query: listAlertsQuery },
      handler: (req, res, { query }) => controller.list(req, res, query),
    });
  }

  // Static segments are declared before /alerts/:id.
  api.route({
    method: 'get',
    path: '/alerts/summary',
    access: { permission: 'alerts:read' },
    handler: (req, res) => controller.summary(req, res),
  });

  api.route({
    method: 'get',
    path: '/alerts/:id',
    access: { permission: 'alerts:read' },
    schemas: { params: alertIdParams },
    handler: (req, res, { params }) => controller.get(req, res, params.id),
  });

  api.route({
    method: 'patch',
    path: '/alerts/:id/resolve',
    access: { permission: 'alerts:resolve', userOnly: true },
    schemas: { params: alertIdParams, body: resolveAlertBody },
    handler: (req, res, { params, body }) => controller.resolve(req, res, params.id, body.note),
  });

  const regenerateLimiter = createLimiter(deps.redis, {
    keyPrefix: 'regenerate:user',
    points: 10,
    duration: 60,
  });
  api.route({
    method: 'post',
    path: '/alerts/:id/regenerate',
    access: { permission: 'alerts:regenerate', userOnly: true },
    middleware: [
      rateLimit({
        limiter: regenerateLimiter,
        points: 10,
        key: (req) => req.principal.id,
        logger: deps.logger,
      }),
    ],
    schemas: { params: alertIdParams },
    handler: (req, res, { params }) => controller.regenerate(req, res, params.id),
  });
};
