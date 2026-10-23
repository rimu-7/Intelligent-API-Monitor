import { isAnomalyCode } from '@apimon/shared';
import type { Logger } from '../../infrastructure/logger';
import type { AiJobData } from '../../infrastructure/queue/queues';
import type { AlertRow } from '../../infrastructure/database/schema';
import type { Thresholds } from '../monitoring/anomaly-engine/types';
import type { AiCache } from './ai-cache';
import {
  buildPromptInput,
  buildUserPrompt,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  type PromptInput,
} from './alert-prompt';
import type { CircuitBreaker } from './circuit-breaker';
import { guardOutput } from './output-guard';
import type { LlmProvider } from './providers/llm-provider';
import { buildTemplateAlert, type AlertText } from './template-alert';

export interface EnrichmentUpdate {
  text: AlertText;
  aiStatus: 'COMPLETED' | 'FALLBACK';
  provider: string;
  model: string | null;
  promptVersion: string;
}

/** Persistence used by the enrichment service (implemented by AlertsRepository). */
export interface EnrichmentStore {
  findById(id: string): Promise<AlertRow | undefined>;
  /** Applies only if the alert is still PENDING at `enrichmentVersion`; returns the updated row. */
  applyEnrichment(
    id: string,
    enrichmentVersion: number,
    update: EnrichmentUpdate,
  ): Promise<AlertRow | undefined>;
}

export interface ThresholdLookup {
  getThresholds(names: readonly string[]): Promise<Map<string, Thresholds>>;
  merge(stored: undefined): Thresholds;
}

export type EnrichmentResult =
  | { outcome: 'skipped'; reason: 'missing' | 'version_mismatch' | 'not_pending' | 'superseded' }
  | { outcome: 'completed' | 'fallback'; alert: AlertRow };

export interface AlertEnrichmentDeps {
  store: EnrichmentStore;
  thresholds: ThresholdLookup;
  providers: readonly LlmProvider[];
  breakers: ReadonlyMap<string, CircuitBreaker>;
  cache: Pick<AiCache, 'get' | 'set'>;
  timeoutMs: number;
  logger: Logger;
}

/**
 * AI enriches, never decides (§2.3, §9.1): cache → providers in order (circuit not OPEN) →
 * output guard → deterministic template. Provider failures never throw — FALLBACK is a valid
 * outcome — so job retries happen only for infrastructure errors (DB/Redis).
 */
export class AlertEnrichmentService {
  constructor(private readonly deps: AlertEnrichmentDeps) {}

  async enrich(job: AiJobData): Promise<EnrichmentResult> {
    const { store, logger } = this.deps;
    const alert = await store.findById(job.alertId);
    if (!alert) return { outcome: 'skipped', reason: 'missing' };
    if (alert.enrichmentVersion !== job.enrichmentVersion)
      return { outcome: 'skipped', reason: 'version_mismatch' };
    if (alert.aiStatus !== 'PENDING') return { outcome: 'skipped', reason: 'not_pending' };

    const thresholds =
      (await this.deps.thresholds.getThresholds([alert.apiName])).get(alert.apiName) ??
      this.deps.thresholds.merge(undefined);
    const anomalyTypes = alert.anomalyTypes.filter(isAnomalyCode);
    const input = buildPromptInput(
      {
        apiName: alert.apiName,
        statusCode: alert.statusCode,
        responseTimeMs: alert.responseTimeMs,
        recordsReturned: alert.recordsReturned,
        severity: alert.severity,
        anomalyTypes,
        occurrenceCount: alert.occurrenceCount,
      },
      thresholds,
      job.context,
    );

    const started = performance.now();
    const generated = await this.generate(input, job.skipCache === true);
    const update: EnrichmentUpdate = generated ?? {
      text: buildTemplateAlert({
        apiName: alert.apiName,
        statusCode: alert.statusCode,
        responseTimeMs: alert.responseTimeMs,
        recordsReturned: alert.recordsReturned,
        codes: anomalyTypes,
        issues:
          anomalyTypes.includes('MISSING_RECORDS') && alert.recordsReturned === null
            ? [{ field: 'records_returned', problem: 'missing' }]
            : [],
        latencyWarningMs: thresholds.latencyWarningMs,
      }),
      aiStatus: 'FALLBACK',
      provider: 'template',
      model: null,
      promptVersion: PROMPT_VERSION,
    };

    const updated = await store.applyEnrichment(alert.id, job.enrichmentVersion, update);
    logger.info(
      {
        event: 'ai.enrichment.completed',
        alert_id: alert.id,
        provider: update.provider,
        model: update.model,
        latency_ms: Math.round(performance.now() - started),
        outcome: update.aiStatus,
        cache_hit: generated?.cacheHit ?? false,
        prompt_version: PROMPT_VERSION,
        context: job.context,
      },
      'alert enrichment finished',
    );
    if (!updated) return { outcome: 'skipped', reason: 'superseded' };
    return { outcome: update.aiStatus === 'COMPLETED' ? 'completed' : 'fallback', alert: updated };
  }

  private async generate(
    input: PromptInput,
    skipCache: boolean,
  ): Promise<(EnrichmentUpdate & { cacheHit: boolean }) | null> {
    const { providers, breakers, cache, timeoutMs, logger } = this.deps;
    if (providers.length === 0) return null;

    if (!skipCache) {
      const cached = await cache.get(input);
      if (cached) {
        return {
          text: cached,
          aiStatus: 'COMPLETED',
          provider: cached.provider,
          model: cached.model,
          promptVersion: PROMPT_VERSION,
          cacheHit: true,
        };
      }
    }

    const user = buildUserPrompt(input);
    for (const provider of providers) {
      const breaker = breakers.get(provider.name);
      if (breaker && !breaker.tryAcquire()) {
        logger.debug({ provider: provider.name }, 'circuit open, skipping provider');
        continue;
      }

      const started = performance.now();
      let raw: string;
      try {
        raw = await provider.complete({
          system: SYSTEM_PROMPT,
          user,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        breaker?.recordFailure();
        logger.warn(
          {
            event: 'ai.provider.failed',
            provider: provider.name,
            model: provider.model,
            latency_ms: Math.round(performance.now() - started),
            error: describeError(err),
          },
          'LLM provider call failed',
        );
        continue;
      }
      // The call itself worked: output-guard rejections never count toward opening the breaker.
      breaker?.recordSuccess();

      const guarded = guardOutput(raw, input);
      if (!guarded.ok) {
        logger.warn(
          {
            event: 'ai.output.rejected',
            provider: provider.name,
            model: provider.model,
            reason: guarded.reason,
            detail: guarded.detail,
          },
          'LLM output rejected by guard',
        );
        continue;
      }

      await cache.set(input, { ...guarded.text, provider: provider.name, model: provider.model });
      return {
        text: guarded.text,
        aiStatus: 'COMPLETED',
        provider: provider.name,
        model: provider.model,
        promptVersion: PROMPT_VERSION,
        cacheHit: false,
      };
    }
    return null;
  }
}

/** Error summary safe for logs: name, status and message only (never request content). */
const describeError = (err: unknown): Record<string, unknown> => {
  if (!(err instanceof Error)) return { message: 'unknown error' };
  const status = (err as { status?: unknown }).status;
  return {
    name: err.name,
    ...(typeof status === 'number' ? { status } : {}),
    message: err.message.slice(0, 200),
  };
};
