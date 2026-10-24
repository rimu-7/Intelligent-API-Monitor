import { logStartupBanner } from './config/banner';
import { loadEnv } from './config/env';
import { buildContainer } from './container';
import { installCrashHandlers, onShutdownSignal } from './infrastructure/process';
import { startWorkers } from './jobs/schedules';

/** monitor-worker entrypoint: AI enrichment, email and scheduled maintenance (same image as the API). */
const env = loadEnv();
const container = buildContainer({ env, service: 'monitor-worker' });
const { logger } = container;
installCrashHandlers(logger);
logStartupBanner(logger, env, 'monitor-worker');

const handle = await startWorkers(container);
logger.info({ queues: handle.workers.map((worker) => worker.name) }, 'monitor-worker ready');

onShutdownSignal(logger, async () => {
  await handle.close();
  await container.close();
  logger.info('monitor-worker stopped');
});
