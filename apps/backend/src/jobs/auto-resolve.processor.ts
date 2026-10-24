import { MAX_ALERT_EVENTS_PER_RUN } from '@apimon/shared';
import type { Logger } from '../infrastructure/logger';
import { toAlertDto } from '../modules/alerts/alerts.mapper';
import type { AlertsRepository } from '../modules/alerts/alerts.repository';
import type { EventBus } from '../modules/realtime/event-bus';

/** §13.4: ACTIVE alerts without recurrence for N minutes become RESOLVED (source AUTO). */
export const autoResolve = async (deps: {
  alerts: Pick<AlertsRepository, 'autoResolveInactive'>;
  events: EventBus;
  logger: Logger;
  minutes: number;
}): Promise<number> => {
  if (deps.minutes <= 0) return 0;
  const resolved = await deps.alerts.autoResolveInactive(
    deps.minutes,
    `Auto-resolved: no recurrence for ${deps.minutes} minutes`,
  );
  if (resolved.length > MAX_ALERT_EVENTS_PER_RUN) {
    await deps.events.publish('alerts.invalidated', { reason: 'auto_resolve', count: resolved.length });
  } else {
    for (const row of resolved) await deps.events.publish('alert.resolved', { alert: toAlertDto(row) });
  }
  for (const row of resolved) {
    deps.logger.info({ event: 'alert.resolved', alert_id: row.id, source: 'AUTO' }, 'alert auto-resolved');
  }
  return resolved.length;
};
