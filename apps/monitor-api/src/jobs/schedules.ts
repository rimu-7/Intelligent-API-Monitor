import { Worker, type Job } from 'bullmq';
import type { Container } from '../container';
import { MAINTENANCE_JOBS, QUEUE_NAMES } from '../infrastructure/queue/job-names';
import { bullmqConnection } from '../infrastructure/redis/connections';
import { publishInitialCircuitState } from '../modules/ai/circuit-registry';
import { createAiEnrichmentProcessor } from './ai-enrichment.processor';
import { autoResolve } from './auto-resolve.processor';
import { createEmailProcessor } from './email.processor';
import { reconcile } from './reconcile.processor';
import { applyRetention } from './retention.processor';

export interface WorkerHandle {
  workers: Worker[];
  close(): Promise<void>;
}

export interface StartWorkersOptions {
  /** Register the recurring maintenance Job Schedulers (off in tests, which call processors directly). */
  schedulers?: boolean;
}

/** Recurring maintenance (§13.3–13.4), via Job Schedulers (the repeatable-jobs API is deprecated). */
export const registerSchedulers = async (container: Container): Promise<void> => {
  const { maintenance } = container.queues;
  const { env, logger } = container;
  await maintenance.upsertJobScheduler(
    MAINTENANCE_JOBS.reconcile,
    { every: 30_000 },
    { name: MAINTENANCE_JOBS.reconcile },
  );
  // Auto-resolve is opt-in. When off, also remove a scheduler left in Redis by an earlier run,
  // otherwise it would keep firing after the setting changed.
  if (env.ALERT_AUTO_RESOLVE_MINUTES > 0) {
    await maintenance.upsertJobScheduler(
      MAINTENANCE_JOBS.autoResolve,
      { every: 60_000 },
      { name: MAINTENANCE_JOBS.autoResolve },
    );
  } else if (await maintenance.removeJobScheduler(MAINTENANCE_JOBS.autoResolve)) {
    logger.info({ job: MAINTENANCE_JOBS.autoResolve }, 'auto-resolve disabled; scheduler removed');
  }
  await maintenance.upsertJobScheduler(
    MAINTENANCE_JOBS.retention,
    { every: 3_600_000 },
    { name: MAINTENANCE_JOBS.retention },
  );
};

export const runMaintenanceJob = async (container: Container, name: string): Promise<unknown> => {
  const { env, logger, queues, events, alertsRepository, notifications, monitoringRepository } = container;
  switch (name) {
    case MAINTENANCE_JOBS.reconcile:
      return reconcile({ alerts: alertsRepository, notifications, queues, logger });
    case MAINTENANCE_JOBS.autoResolve:
      return autoResolve({
        alerts: alertsRepository,
        events,
        logger,
        minutes: env.ALERT_AUTO_RESOLVE_MINUTES,
      });
    case MAINTENANCE_JOBS.retention:
      return applyRetention({ repository: monitoringRepository, days: env.TELEMETRY_RETENTION_DAYS, logger });
    default:
      logger.warn({ job: name }, 'unknown maintenance job');
      return undefined;
  }
};

/** Starts every BullMQ worker (§13.3). Used by worker.ts and by integration tests in-process. */
export const startWorkers = async (
  container: Container,
  options: StartWorkersOptions = {},
): Promise<WorkerHandle> => {
  const { env, logger, queues } = container;
  const base = { connection: bullmqConnection(env.REDIS_URL), prefix: container.queuePrefix };

  await publishInitialCircuitState(container.breakers, container.redis).catch((err: unknown) =>
    logger.warn({ err }, 'could not publish initial circuit state'),
  );

  const ai = new Worker(
    QUEUE_NAMES.aiEnrichment,
    createAiEnrichmentProcessor({
      enrichment: container.enrichment,
      events: container.events,
      queues,
      notifications: container.notifications,
      logger,
    }),
    { ...base, concurrency: env.AI_WORKER_CONCURRENCY, limiter: { max: 10, duration: 1_000 } },
  );
  const email = new Worker(QUEUE_NAMES.email, createEmailProcessor(container.notificationsService), {
    ...base,
    concurrency: 2,
  });
  const maintenance = new Worker(
    QUEUE_NAMES.maintenance,
    (job: Job) => runMaintenanceJob(container, job.name),
    {
      ...base,
      concurrency: 1,
    },
  );

  const workers = [ai, email, maintenance];
  for (const worker of workers) {
    worker.on('failed', (job: Job | undefined, err: Error) =>
      logger.error({ err, queue: worker.name, job_id: job?.id, attempts: job?.attemptsMade }, 'job failed'),
    );
    worker.on('error', (err) => logger.warn({ err, queue: worker.name }, 'worker connection error'));
  }
  await Promise.all(workers.map((worker) => worker.waitUntilReady()));
  if (options.schedulers ?? true) await registerSchedulers(container);

  return {
    workers,
    // worker.close() waits for active jobs to finish (§16.4).
    close: async () => {
      await Promise.allSettled(workers.map((worker) => worker.close()));
    },
  };
};
