import type { SecureRouter } from '../../http/secure-router';
import { ok } from '../../http/respond';
import type { HealthService } from './health.service';

export const registerHealthRoutes = (router: SecureRouter, health: HealthService): void => {
  router.route({
    method: 'get',
    path: '/health/live',
    access: { public: true },
    handler: (_req, res) => ok(res, { status: 'ok' }),
  });

  router.route({
    method: 'get',
    path: '/health/ready',
    access: { public: true },
    handler: async (_req, res) => ok(res, await health.ready()),
  });

  router.route({
    method: 'get',
    path: '/health',
    access: { public: true },
    handler: async (_req, res) => {
      const report = await health.report();
      ok(res, report, { status: report.status === 'ok' ? 200 : 503 });
    },
  });
};
