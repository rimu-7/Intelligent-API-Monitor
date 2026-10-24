import { LLM_PROVIDER_NAMES, type LlmProviderName } from '@apimon/shared';

export type { LlmProviderName };

export const isLlmProviderName = (value: unknown): value is LlmProviderName =>
  typeof value === 'string' && (LLM_PROVIDER_NAMES as readonly string[]).includes(value);

export interface CompletionInput {
  system: string;
  user: string;
  signal: AbortSignal;
}

/** One LLM backend (§9.3). `complete` returns raw text; the output guard validates it. */
export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  isConfigured(): boolean;
  complete(input: CompletionInput): Promise<string>;
}

/** Shared generation settings (§9.3). */
export const GENERATION = { temperature: 0.2, maxOutputTokens: 400 } as const;

export class EmptyCompletionError extends Error {
  constructor(provider: LlmProviderName) {
    super(`${provider} returned an empty completion`);
    this.name = 'EmptyCompletionError';
  }
}
