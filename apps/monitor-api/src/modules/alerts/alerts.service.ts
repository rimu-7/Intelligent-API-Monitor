import type { AlertDetailDto, AlertDto, AlertSummaryDto } from '@apimon/shared';
import { SUMMARY_CACHE_KEY } from './alerts.cache';
import type { Redis } from 'ioredis';
import type { Logger } from '../../infrastructure/logger';
import type { Queues } from '../../infrastructure/queue/queues';
import type { UserPrincipal } from '../../http/principal';
import { ConflictError, NotFoundError } from '../../lib/errors';
import type { AuditContext, AuditService } from '../audit/audit.service';
import type { EventBus } from '../realtime/event-bus';
import { toAlertDetailDto, toAlertDto } from './alerts.mapper';
import type { AlertsRepository } from './alerts.repository';
import type { ListAlertsInput } from './alerts.schemas';

const SUMMARY_TTL_SECONDS = 5;

export interface AlertsServiceDeps {
  repository: AlertsRepository;
  redis: Redis;
  queues: Queues;
  events: EventBus;
  audit: AuditService;
  logger: Logger;
}

export class AlertsService {
  constructor(private readonly deps: AlertsServiceDeps) {}

  async list(query: ListAlertsInput): Promise<{ items: AlertDto[]; total: number }> {
    const { items, total } = await this.deps.repository.list({
      status: query.status,
      sort: query.sort,
      limit: query.limit,
      offset: query.offset,
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.api_name ? { apiName: query.api_name } : {}),
      ...(query.anomaly_type ? { anomalyType: query.anomaly_type } : {}),
    });
    return { items: items.map(toAlertDto), total };
  }

  async get(id: string): Promise<AlertDetailDto> {
    const row = await this.deps.repository.findById(id);
    if (!row) throw new NotFoundError('Alert not found');
    return toAlertDetailDto(row, await this.deps.repository.recentSamples(id, 20));
  }

  /** Counts by status/severity + top APIs, cached for 5 s. */
  async summary(): Promise<AlertSummaryDto> {
    const { redis, repository, logger } = this.deps;
    try {
      const cached = await redis.get(SUMMARY_CACHE_KEY);
      if (cached) return JSON.parse(cached) as AlertSummaryDto;
    } catch (err) {
      logger.warn({ err }, 'summary cache read failed');
    }
    const counts = await repository.counts();
    const summary: AlertSummaryDto = {
      active: {
        total: counts.activeCritical + counts.activeWarning,
        critical: counts.activeCritical,
        warning: counts.activeWarning,
      },
      resolved: counts.resolved,
      top_apis: counts.topApis.map((api) => ({
        api_name: api.apiName,
        active_alerts: api.activeAlerts,
        critical: api.critical,
      })),
      generated_at: new Date().toISOString(),
    };
    redis.set(SUMMARY_CACHE_KEY, JSON.stringify(summary), 'EX', SUMMARY_TTL_SECONDS).catch((err: unknown) => {
      logger.warn({ err }, 'summary cache write failed');
    });
    return summary;
  }

  async resolve(
    id: string,
    actor: UserPrincipal,
    note: string | undefined,
    context: AuditContext,
  ): Promise<AlertDto> {
    const { repository, audit, events, logger } = this.deps;
    const row = await repository.resolve(id, { resolvedBy: actor.id, source: 'MANUAL', note: note ?? null });
    if (!row) {
      if (await repository.findById(id))
        throw new ConflictError('Alert is already resolved', 'ALERT_ALREADY_RESOLVED');
      throw new NotFoundError('Alert not found');
    }
    const alert = toAlertDto(row);
    await audit.record({
      action: 'alert.resolved',
      actor,
      target: { type: 'alert', id },
      metadata: { note: note ?? null },
      context,
    });
    await this.invalidateSummary();
    await events.publish('alert.resolved', { alert });
    logger.info({ event: 'alert.resolved', alert_id: id, source: 'MANUAL' }, 'alert resolved');
    return alert;
  }

  /** §9.8: PENDING + new enrichment version, bypassing the AI cache. */
  async regenerate(id: string, actor: UserPrincipal, context: AuditContext): Promise<AlertDto> {
    const { repository, queues, audit, events, logger } = this.deps;
    const before = await repository.findById(id);
    if (!before) throw new NotFoundError('Alert not found');
    // First AI request for an incident that skipped automatic AI: same prompt as automatic
    // enrichment, and a cached answer for identical metrics is fine (and free).
    // A re-analysis of existing AI text always asks the model again.
    const firstRequest = before.aiStatus === 'SKIPPED';
    const row = await repository.markForRegeneration(id);
    if (!row) throw new NotFoundError('Alert not found');
    try {
      await queues.enqueueAi({
        alertId: row.id,
        enrichmentVersion: row.enrichmentVersion,
        context: firstRequest ? (row.escalatedAt ? 'escalation' : 'new_incident') : 'regeneration',
        skipCache: !firstRequest,
        ...(context.requestId ? { requestId: context.requestId } : {}),
      });
    } catch (err) {
      logger.error({ err, alert_id: id }, 'failed to enqueue regeneration; reconciler will retry');
    }
    const alert = toAlertDto(row);
    await audit.record({
      action: 'alert.regenerated',
      actor,
      target: { type: 'alert', id },
      metadata: { enrichment_version: row.enrichmentVersion, first_request: firstRequest },
      context,
    });
    await events.publish('alert.updated', { alert });
    return alert;
  }

  async invalidateSummary(): Promise<void> {
    await this.deps.redis.del(SUMMARY_CACHE_KEY).catch(() => undefined);
  }
}
