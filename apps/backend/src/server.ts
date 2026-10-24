import { setTimeout as sleep } from 'node:timers/promises';
import { createApp } from './app';
import { logStartupBanner } from './config/banner';
import { loadEnv } from './config/env';
import { buildContainer } from './container';
import { installCrashHandlers, onShutdownSignal } from './infrastructure/process';

const env = loadEnv();
const container = buildContainer({ env, service: 'monitor-api', withAiEvents: true, withRealtime: true });
const { logger } = container;
installCrashHandlers(logger);
logStartupBanner(logger, env, 'monitor-api');

await container.passwords.warmUp();
await container.sseHub?.start();
const { app } = createApp(container);

const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT }, `monitor-api listening on :${env.API_PORT}`);
});
server.on('error', (err) => {
  logger.fatal({ err }, 'http server failed');
  process.exit(1);
});

// §16.4: readiness 503 → stop accepting → end SSE → drain ≤10 s → close connections.
onShutdownSignal(logger, async () => {
  container.lifecycle.shuttingDown = true;
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  await container.beforeHttpClose?.();
  server.closeIdleConnections();
  await Promise.race([closed, sleep(10_000)]);
  server.closeAllConnections();
  await container.close();
  logger.info('monitor-api stopped');
});
