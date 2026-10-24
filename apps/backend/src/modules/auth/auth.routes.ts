import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env';
import { clientIp, createLimiter, rateLimit } from '../../http/middleware/rate-limit';
import type { SecureRouter } from '../../http/secure-router';
import type { Logger } from '../../infrastructure/logger';
import { ForbiddenError } from '../../lib/errors';
import type { AuthController } from './auth.controller';
import { changePasswordBody, loginBody } from './auth.schemas';

/** CSRF defence in depth for cookie-authenticated endpoints (§12.4, A14). */
const requireAllowedOrigin =
  (allowed: readonly string[]): RequestHandler =>
  (req, _res, next) => {
    const origin = req.header('origin');
    if (!origin || !allowed.includes(origin)) {
      throw new ForbiddenError('Origin not allowed for cookie-authenticated requests');
    }
    next();
  };

export const registerAuthRoutes = (
  router: SecureRouter,
  controller: AuthController,
  deps: { env: Env; redis: Redis; logger: Logger },
): void => {
  const refreshLimiter = createLimiter(deps.redis, { keyPrefix: 'refresh:ip', points: 60, duration: 60 });
  const originCheck = requireAllowedOrigin(deps.env.CORS_ALLOWED_ORIGINS);

  // Public; brute-force protection lives in LoginThrottle (per IP + per email).
  router.route({
    method: 'post',
    path: '/auth/login',
    access: { public: true },
    schemas: { body: loginBody },
    handler: (req, res, { body }) => controller.login(req, res, body),
  });

  router.route({
    method: 'post',
    path: '/auth/refresh',
    access: { public: true },
    middleware: [
      originCheck,
      rateLimit({ limiter: refreshLimiter, points: 60, key: clientIp, logger: deps.logger }),
    ],
    handler: (req, res) => controller.refresh(req, res),
  });

  router.route({
    method: 'post',
    path: '/auth/logout',
    access: { public: true },
    middleware: [originCheck],
    handler: (req, res) => controller.logout(req, res),
  });

  router.route({
    method: 'get',
    path: '/auth/me',
    access: { authenticated: true },
    handler: (req, res) => controller.me(req, res),
  });

  router.route({
    method: 'post',
    path: '/auth/change-password',
    access: { authenticated: true },
    schemas: { body: changePasswordBody },
    handler: (req, res, { body }) => controller.changePassword(req, res, body),
  });
};
