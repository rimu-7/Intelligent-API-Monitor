import type { Env } from '../../../config/env';
import { GeminiProvider } from './gemini.provider';
import type { LlmProvider } from './llm-provider';
import { MistralProvider } from './mistral.provider';
import { OpenAiProvider } from './openai.provider';

/** Configured providers in AI_PROVIDER_ORDER. Unconfigured ones are left out entirely. */
export const createProviders = (env: Env): LlmProvider[] => {
  const all: Record<LlmProvider['name'], LlmProvider> = {
    gemini: new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL ?? ''),
    openai: new OpenAiProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL ?? ''),
    mistral: new MistralProvider(env.MISTRAL_API_KEY, env.MISTRAL_MODEL ?? ''),
  };
  return env.AI_PROVIDER_ORDER.map((name) => all[name]).filter((provider) => provider.isConfigured());
};
