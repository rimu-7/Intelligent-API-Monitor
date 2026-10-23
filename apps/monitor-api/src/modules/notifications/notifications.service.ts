import type { Logger } from '../../infrastructure/logger';
import type { Mailer } from '../../infrastructure/mail/mailer';
import type { AlertsRepository } from '../alerts/alerts.repository';
import { buildAlertEmail } from './email-templates';
import type { NotificationsRepository } from './notifications.repository';

export interface NotificationsServiceDeps {
  repository: NotificationsRepository;
  alerts: Pick<AlertsRepository, 'findById'>;
  mailer: Mailer;
  to: string;
  publicWebUrl: string;
  logger: Logger;
}

/** Sends one alert notification (§13.2). Failures are recorded and rethrown so BullMQ retries. */
export class NotificationsService {
  constructor(private readonly deps: NotificationsServiceDeps) {}

  async send(notificationId: string): Promise<'sent' | 'skipped'> {
    const { repository, alerts, mailer, logger } = this.deps;
    const claimed = await repository.claim(notificationId);
    if (!claimed) return 'skipped';

    try {
      const alert = await alerts.findById(claimed.alertId);
      if (!alert) {
        await repository.markFailed(claimed.id, 'alert no longer exists');
        return 'skipped';
      }
      const email = buildAlertEmail(alert, claimed.reason, this.deps.publicWebUrl);
      await mailer.send({ to: this.deps.to, ...email });
      await repository.markSent(claimed.id);
      logger.info(
        {
          event: 'email.sent',
          notification_id: claimed.id,
          alert_id: alert.id,
          reason: claimed.reason,
          attempts: claimed.attempts,
        },
        'alert email sent',
      );
      return 'sent';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      await repository.markFailed(claimed.id, message);
      logger.warn(
        { event: 'email.failed', notification_id: claimed.id, attempts: claimed.attempts, err },
        'alert email failed',
      );
      throw err;
    }
  }
}
