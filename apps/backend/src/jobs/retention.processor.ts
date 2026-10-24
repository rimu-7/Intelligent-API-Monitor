import type { Logger } from '../infrastructure/logger';
import type { MonitoringRepository } from '../modules/monitoring/monitoring.repository';

const BATCH = 5_000;

/** §13.4: delete telemetry and rejected rows older than N days in batches, then empty runs. */
export const applyRetention = async (deps: {
  repository: Pick<MonitoringRepository, 'deleteOldTelemetry' | 'deleteOldRejected' | 'deleteEmptyOldRuns'>;
  days: number;
  logger: Logger;
}) => {
  const { repository, days } = deps;
  const drain = async (deleteBatch: () => Promise<number>) => {
    let total = 0;
    for (;;) {
      const deleted = await deleteBatch();
      total += deleted;
      if (deleted < BATCH) return total;
    }
  };
  const telemetry = await drain(() => repository.deleteOldTelemetry(days, BATCH));
  const rejected = await drain(() => repository.deleteOldRejected(days, BATCH));
  const runs = await repository.deleteEmptyOldRuns(days);
  if (telemetry + rejected + runs > 0) {
    deps.logger.info({ event: 'retention.applied', telemetry, rejected, runs, days }, 'retention applied');
  }
  return { telemetry, rejected, runs };
};
