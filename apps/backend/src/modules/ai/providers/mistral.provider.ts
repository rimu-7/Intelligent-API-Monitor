import { Mistral } from '@mistralai/mistralai';
import { EmptyCompletionError, GENERATION, type CompletionInput, type LlmProvider } from './llm-provider';

const normalizeMistralModel = (rawModel: string): string => {
  const m = rawModel.trim().replace(/^["']|["']$/g, '');
  if (m === 'mistral-8b' || m === 'mistral-8b-latest') return 'ministral-8b-latest';
  if (m === 'mistral-3b' || m === 'mistral-3b-latest') return 'ministral-3b-latest';
  return m;
};

export class MistralProvider implements LlmProvider {
  readonly name = 'mistral' as const;
  private readonly client: Mistral | undefined;
  readonly model: string;

  constructor(apiKey: string | undefined, model: string) {
    const cleanKey = apiKey ? apiKey.trim().replace(/^["']|["']$/g, '') : undefined;
    this.model = normalizeMistralModel(model);
    this.client = cleanKey ? new Mistral({ apiKey: cleanKey, retryConfig: { strategy: 'none' } }) : undefined;
  }

  isConfigured(): boolean {
    return this.client !== undefined && this.model.length > 0;
  }

  async complete({ system, user, signal }: CompletionInput): Promise<string> {
    if (!this.client) throw new Error('mistral is not configured');
    const response = await this.client.chat.complete(
      {
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        responseFormat: { type: 'json_object' },
        temperature: GENERATION.temperature,
        maxTokens: GENERATION.maxOutputTokens,
      },
      { signal },
    );
    const content = response.choices[0]?.message?.content;
    const text =
      typeof content === 'string'
        ? content
        : (content ?? [])
            .map((chunk) => ('text' in chunk && typeof chunk.text === 'string' ? chunk.text : ''))
            .join('');
    if (!text) throw new EmptyCompletionError(this.name);
    return text;
  }
}
