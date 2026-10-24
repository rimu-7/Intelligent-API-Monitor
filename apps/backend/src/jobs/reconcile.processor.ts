import type { Logger } from '../infrastructure/logger';
import type { Queues } from '../infrastructure/queue/queues';
import { aiJobId } from '../infrastructure/queue/job-names';
import type { AlertsRepository } from '../modules/alerts/alerts.repository';
import type { NotificationsRepository } from '../modules/notifications/notifications.repository';

export interface ReconcileDeps {
  alerts: Pick<AlertsRepository, 'findStalePending'>;
  notifications: Pick<NotificationsRepository, 'stalePendingIds'>;
  queues: Queues;
  logger: Logger;
}

/**
 * Finds async work stuck in Postgres and re-enqueues it (§2.3 principle 5, §13.4). Same job ids,
 * so live duplicates are ignored; a job that already failed for good is retried.
 */
export const reconcile = async ({ alerts, notifications, queues, logger }: ReconcileDeps) => {
  let ai = 0;
  for (const alert of await alerts.findStalePending(30)) {
    try {
      const existing = await queues.ai.getJob(aiJobId(alert.id, alert.enrichmentVersion));
      if (existing && (await existing.isFailed())) {
        await existing.retry();
      } else if (!existing || (await existing.isCompleted())) {
        if (existing) await existing.remove();
        await queues.enqueueAi({
          alertId: alert.id,
          enrichmentVersion: alert.enrichmentVersion,
          context: alert.escalatedAt ? 'escalation' : 'new_incident',
        });
      } else {
        continue; // waiting / active / delayed: already on its way
      }
      ai += 1;
    } catch (err) {
      logger.error({ err, alert_id: alert.id }, 'reconcile: could not re-enqueue AI job');
    }
  }

  let email = 0;
  for (const notificationId of await notifications.stalePendingIds()) {
    try {
      await queues.enqueueEmail({ notificationId });
      email += 1;
    } catch (err) {
      logger.error({ err, notification_id: notificationId }, 'reconcile: could not enqueue email');
    }
  }

  if (ai > 0 || email > 0)
    logger.info({ event: 'reconcile.requeued', ai, email }, 'reconciler re-enqueued work');
  return { ai, email };
};
