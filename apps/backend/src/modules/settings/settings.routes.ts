import type { Redis } from 'ioredis';
import { createLimiter, rateLimit } from '../../http/middleware/rate-limit';
import type { SecureRouter } from '../../http/secure-router';
import type { Logger } from '../../infrastructure/logger';
import type { SettingsController } from './settings.controller';
import { testEmailBody, updateNotificationSettingsBody } from './settings.schemas';

export const registerSettingsRoutes = (
  api: SecureRouter,
  controller: SettingsController,
  deps: { redis: Redis; logger: Logger },
): void => {
  // Each test email opens a real SMTP connection; keep it to a handful per minute per user.
  const testEmailLimiter = createLimiter(deps.redis, {
    keyPrefix: 'test-email:user',
    points: 5,
    duration: 60,
  });

  api.route({
    method: 'get',
    path: '/settings/notifications',
    access: { permission: 'settings:manage', userOnly: true },
    handler: (req, res) => controller.getNotifications(req, res),
  });

  api.route({
    method: 'patch',
    path: '/settings/notifications',
    access: { permission: 'settings:manage', userOnly: true },
    schemas: { body: updateNotificationSettingsBody },
    handler: (req, res, { body }) => controller.updateNotifications(req, res, body),
  });

  api.route({
    method: 'post',
    path: '/settings/notifications/test',
    access: { permission: 'settings:manage', userOnly: true },
    middleware: [
      rateLimit({
        limiter: testEmailLimiter,
        points: 5,
        key: (req) => (req.principal.kind === 'user' ? req.principal.id : (req.ip ?? 'unknown')),
        logger: deps.logger,
      }),
    ],
    schemas: { body: testEmailBody },
    handler: (req, res, { body }) => controller.sendTestEmail(req, res, body),
  });
};
