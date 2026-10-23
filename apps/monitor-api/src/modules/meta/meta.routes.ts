import { configuredProviders, type Env } from '../../config/env';
import type { SecureRouter } from '../../http/secure-router';
import { ok } from '../../http/respond';
import { APP_VERSION } from '../../lib/version';

export const registerMetaRoutes = (router: SecureRouter, env: Env): void => {
  router.route({
    method: 'get',
    path: '/meta',
    access: { public: true },
    handler: (_req, res) =>
      ok(res, {
        version: APP_VERSION,
        demo_mode: env.DEMO_MODE,
        email_enabled: env.EMAIL_ENABLED,
        ai_providers: configuredProviders(env),
        default_thresholds: {
          latency_warning_ms: env.LATENCY_WARNING_MS,
          latency_critical_ms: env.LATENCY_CRITICAL_MS,
        },
        max_batch_size: env.MAX_BATCH_SIZE,
      }),
  });
};
