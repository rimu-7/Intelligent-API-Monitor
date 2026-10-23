import { Worker, type Job } from 'bullmq';
import type { Container } from '../container';
import { QUEUE_NAMES } from '../infrastructure/queue/job-names';
import { bullmqConnection } from '../infrastructure/redis/connections';
import { publishInitialCircuitState } from '../modules/ai/circuit-registry';
import { createAiEnrichmentProcessor } from './ai-enrichment.processor';

export interface WorkerHandle {
  workers: Worker[];
  close(): Promise<void>;
}

/** Starts every BullMQ worker (§13.3). Used by worker.ts and by integration tests in-process. */
export const startWorkers = async (container: Container): Promise<WorkerHandle> => {
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

  const workers = [ai];
  for (const worker of workers) {
    worker.on('failed', (job: Job | undefined, err: Error) =>
      logger.error({ err, queue: worker.name, job_id: job?.id, attempts: job?.attemptsMade }, 'job failed'),
    );
    worker.on('error', (err) => logger.warn({ err, queue: worker.name }, 'worker connection error'));
  }
  await Promise.all(workers.map((worker) => worker.waitUntilReady()));

  return {
    workers,
    // worker.close() waits for active jobs to finish (§16.4).
    close: async () => {
      await Promise.allSettled(workers.map((worker) => worker.close()));
    },
  };
};
