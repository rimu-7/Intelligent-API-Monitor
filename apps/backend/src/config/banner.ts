import type { Logger } from '../infrastructure/logger';
import { APP_VERSION } from '../lib/version';
import { configuredProviders, type Env } from './env';

/** Startup banner (§5.2): never logs secret values — providers by name only. */
export const logStartupBanner = (logger: Logger, env: Env, role: string): void => {
  logger.info(
    {
      event: 'startup',
      role,
      version: APP_VERSION,
      app_env: env.APP_ENV,
      demo_mode: env.DEMO_MODE,
      urls: {
        api: `http://localhost:${env.API_PORT}`,
        docs: `http://localhost:${env.API_PORT}/docs`,
        simulator: env.SIMULATOR_URL,
        web: env.PUBLIC_WEB_URL,
      },
      ai_providers: configuredProviders(env),
      email_enabled: env.EMAIL_ENABLED,
    },
    `${role} starting`,
  );
  if (env.DEMO_MODE) {
    logger.warn(
      { event: 'demo_mode' },
      'DEMO_MODE=true: anonymous callers can ingest telemetry and read alerts',
    );
  }
  if (configuredProviders(env).length === 0) {
    logger.info(
      { event: 'ai.disabled' },
      'no LLM provider configured: alerts use the deterministic template',
    );
  }
};
