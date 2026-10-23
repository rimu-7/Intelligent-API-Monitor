import { Queue, QueueEvents } from 'bullmq';
import { z } from 'zod';
import type { Logger } from '../logger';
import { bullmqConnection } from '../redis/connections';
import { withTimeout } from '../../lib/timeout';
import { aiJobId, emailJobId, PROMPT_CONTEXTS, QUEUE_NAMES } from './job-names';

/** Job payloads are validated at the boundary like any other input (§ CLAUDE.md "Zod at every boundary"). */
export const aiJobSchema = z.strictObject({
  alertId: z.uuid(),
  enrichmentVersion: z.number().int().min(1),
  context: z.enum(PROMPT_CONTEXTS),
  skipCache: z.boolean().optional(),
  requestId: z.string().max(64).optional(),
});
export type AiJobData = z.infer<typeof aiJobSchema>;

export const emailJobSchema = z.strictObject({
  notificationId: z.uuid(),
  requestId: z.string().max(64).optional(),
});
export type EmailJobData = z.infer<typeof emailJobSchema>;

const KEEP_COMPLETED = { age: 3600, count: 1000 };
const KEEP_FAILED = { age: 7 * 24 * 3600 };
const ENQUEUE_TIMEOUT_MS = 2_000;

export interface QueuesOptions {
  redisUrl: string;
  /** "apimon" in every service, "apimon-test" in tests (§13.3). */
  prefix: string;
  logger: Logger;
  /** The API process waits on AI jobs (sync wait) and needs QueueEvents; the worker does not. */
  withAiEvents: boolean;
}

/** Producer side of the three queues. Workers live in jobs/schedules.ts. */
export class Queues {
  readonly ai: Queue<AiJobData>;
  readonly email: Queue<EmailJobData>;
  readonly maintenance: Queue;
  private aiEvents: QueueEvents | undefined;

  constructor(options: QueuesOptions) {
    const base = { connection: bullmqConnection(options.redisUrl), prefix: options.prefix };
    this.ai = new Queue<AiJobData>(QUEUE_NAMES.aiEnrichment, {
      ...base,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: KEEP_COMPLETED,
        removeOnFail: KEEP_FAILED,
      },
    });
    this.email = new Queue<EmailJobData>(QUEUE_NAMES.email, {
      ...base,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: KEEP_COMPLETED,
        removeOnFail: KEEP_FAILED,
      },
    });
    this.maintenance = new Queue(QUEUE_NAMES.maintenance, {
      ...base,
      defaultJobOptions: { removeOnComplete: KEEP_COMPLETED, removeOnFail: KEEP_FAILED },
    });
    if (options.withAiEvents) {
      this.aiEvents = new QueueEvents(QUEUE_NAMES.aiEnrichment, base);
      this.aiEvents.on('error', (err) => options.logger.warn({ err }, 'ai queue events error'));
    }
    for (const queue of [this.ai, this.email, this.maintenance]) {
      queue.on('error', (err) => options.logger.warn({ err, queue: queue.name }, 'queue connection error'));
    }
  }

  /** Same jobId for the same alert version: duplicates are ignored by BullMQ. */
  async enqueueAi(data: AiJobData): Promise<string> {
    const jobId = aiJobId(data.alertId, data.enrichmentVersion);
    await withTimeout(
      this.ai.add('enrich', aiJobSchema.parse(data), { jobId }),
      ENQUEUE_TIMEOUT_MS,
      'enqueue ai job',
    );
    return jobId;
  }

  async enqueueEmail(data: EmailJobData): Promise<string> {
    const jobId = emailJobId(data.notificationId);
    await withTimeout(
      this.email.add('send', emailJobSchema.parse(data), { jobId }),
      ENQUEUE_TIMEOUT_MS,
      'enqueue email job',
    );
    return jobId;
  }

  /**
   * Waits up to `timeoutMs` for the given AI jobs. A timeout or failure is not an error —
   * the alert simply still shows its template text (§8.1 step 8).
   */
  async waitForAiJobs(jobIds: readonly string[], timeoutMs: number): Promise<void> {
    const events = this.aiEvents;
    if (!events || jobIds.length === 0 || timeoutMs <= 0) return;
    await events.waitUntilReady();
    const deadline = Date.now() + timeoutMs;
    await Promise.allSettled(
      jobIds.map(async (jobId) => {
        const job = await this.ai.getJob(jobId);
        if (!job) return;
        const remaining = deadline - Date.now();
        if (remaining <= 0) return;
        await job.waitUntilFinished(events, remaining);
      }),
    );
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      this.aiEvents?.close(),
      this.ai.close(),
      this.email.close(),
      this.maintenance.close(),
    ]);
  }
}
