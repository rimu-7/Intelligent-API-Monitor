import type { Job } from 'bullmq';
import type { Logger } from '../infrastructure/logger';
import { aiJobSchema, type Queues } from '../infrastructure/queue/queues';
import type { AlertEnrichmentService } from '../modules/ai/alert-enrichment.service';
import { toAlertDto } from '../modules/alerts/alerts.mapper';
import type { NotificationsRepository } from '../modules/notifications/notifications.repository';
import type { EventBus } from '../modules/realtime/event-bus';

export interface AiProcessorDeps {
  enrichment: AlertEnrichmentService;
  events: EventBus;
  queues: Queues;
  notifications: NotificationsRepository;
  logger: Logger;
}

/**
 * Enriches one alert, publishes `alert.updated`, then queues the alert's pending emails so they
 * carry the final text (§13.2). Throws only on infrastructure errors (BullMQ retries those).
 */
export const createAiEnrichmentProcessor =
  ({ enrichment, events, queues, notifications, logger }: AiProcessorDeps) =>
  async (job: Job): Promise<string> => {
    const data = aiJobSchema.parse(job.data);
    const log = logger.child({ job_id: job.id, request_id: data.requestId });
    const result = await enrichment.enrich(data);
    if (result.outcome === 'skipped') {
      log.debug({ alert_id: data.alertId, reason: result.reason }, 'enrichment skipped');
      return `skipped:${result.reason}`;
    }

    await events.publish('alert.updated', { alert: toAlertDto(result.alert) });
    for (const notificationId of await notifications.pendingIdsForAlert(result.alert.id)) {
      try {
        await queues.enqueueEmail({
          notificationId,
          ...(data.requestId ? { requestId: data.requestId } : {}),
        });
      } catch (err) {
        log.error({ err, notification_id: notificationId }, 'failed to enqueue email; reconciler will retry');
      }
    }
    return result.outcome;
  };
