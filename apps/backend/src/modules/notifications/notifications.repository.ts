import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../infrastructure/database/client';
import { alertNotifications, alerts, type AlertNotificationRow } from '../../infrastructure/database/schema';

export class NotificationsRepository {
  constructor(private readonly db: DbExecutor) {}

  async pendingIdsForAlert(alertId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: alertNotifications.id })
      .from(alertNotifications)
      .where(and(eq(alertNotifications.alertId, alertId), eq(alertNotifications.status, 'PENDING')));
    return rows.map((row) => row.id);
  }

  /** Atomic claim (§13.2): only one worker sends a given notification. */
  async claim(id: string): Promise<AlertNotificationRow | undefined> {
    const [row] = await this.db
      .update(alertNotifications)
      .set({ status: 'SENDING', attempts: sql`${alertNotifications.attempts} + 1` })
      .where(and(eq(alertNotifications.id, id), inArray(alertNotifications.status, ['PENDING', 'FAILED'])))
      .returning();
    return row;
  }

  async markSent(id: string): Promise<void> {
    await this.db
      .update(alertNotifications)
      .set({ status: 'SENT', sentAt: new Date(), lastError: null })
      .where(eq(alertNotifications.id, id));
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db
      .update(alertNotifications)
      .set({ status: 'FAILED', lastError: error.slice(0, 500) })
      .where(eq(alertNotifications.id, id));
  }

  /**
   * Reconciler (§13.4): PENDING notifications older than 2 min whose alert is no longer
   * PENDING, or older than 5 min regardless.
   */
  async stalePendingIds(limit = 100): Promise<string[]> {
    const rows = await this.db
      .select({ id: alertNotifications.id })
      .from(alertNotifications)
      .innerJoin(alerts, eq(alerts.id, alertNotifications.alertId))
      .where(
        and(
          eq(alertNotifications.status, 'PENDING'),
          or(
            and(
              lt(alertNotifications.createdAt, sql`now() - interval '2 minutes'`),
              sql`${alerts.aiStatus} <> 'PENDING'`,
            ),
            lt(alertNotifications.createdAt, sql`now() - interval '5 minutes'`),
          ),
        ),
      )
      .limit(limit);
    return rows.map((row) => row.id);
  }
}
