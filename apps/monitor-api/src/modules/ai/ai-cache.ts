import { isLlmProviderName, type LlmProviderName } from './providers/llm-provider';
import type { Redis } from 'ioredis';
import type { Logger } from '../../infrastructure/logger';
import { sha256Hex } from '../../lib/crypto';
import { PROMPT_VERSION, type PromptInput } from './alert-prompt';
import type { AlertText } from './template-alert';

export interface CachedAlertText extends AlertText {
  provider: LlmProviderName;
  model: string;
}

/**
 * §9.7: exact metric values in the key (bucketing would put wrong numbers in cached text).
 * Only successful LLM output is cached; template output never is.
 */
export const aiCacheKey = (input: PromptInput): string => {
  const issueFields = input.anomalies
    .filter((a) => a.code === 'INVALID_METRICS' || a.code === 'MISSING_RECORDS')
    .map((a) => a.detail)
    .join(';');
  const material = [
    input.api_name,
    [...input.anomalies.map((a) => a.code)].sort().join(','),
    input.status_code ?? 'null',
    input.response_time_ms ?? 'null',
    input.records_returned ?? 'null',
    issueFields,
    input.context,
  ].join('|');
  return `ai:alert:${PROMPT_VERSION}:${sha256Hex(material)}`;
};

export class AiCache {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
    private readonly logger: Logger,
  ) {}

  async get(input: PromptInput): Promise<CachedAlertText | undefined> {
    if (this.ttlSeconds === 0) return undefined;
    try {
      const raw = await this.redis.get(aiCacheKey(input));
      if (!raw) return undefined;
      const value = JSON.parse(raw) as Record<string, unknown>;
      if (
        typeof value.alert_message === 'string' &&
        typeof value.probable_cause === 'string' &&
        typeof value.recommended_action === 'string' &&
        isLlmProviderName(value.provider) &&
        typeof value.model === 'string'
      ) {
        return {
          alertMessage: value.alert_message,
          probableCause: value.probable_cause,
          recommendedAction: value.recommended_action,
          provider: value.provider,
          model: value.model,
        };
      }
    } catch (err) {
      this.logger.warn({ err }, 'ai cache read failed');
    }
    return undefined;
  }

  async set(input: PromptInput, value: CachedAlertText): Promise<void> {
    if (this.ttlSeconds === 0) return;
    try {
      await this.redis.set(
        aiCacheKey(input),
        JSON.stringify({
          alert_message: value.alertMessage,
          probable_cause: value.probableCause,
          recommended_action: value.recommendedAction,
          provider: value.provider,
          model: value.model,
        }),
        'EX',
        this.ttlSeconds,
      );
    } catch (err) {
      this.logger.warn({ err }, 'ai cache write failed');
    }
  }
}
