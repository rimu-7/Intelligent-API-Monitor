import { Mistral } from '@mistralai/mistralai';
import { EmptyCompletionError, GENERATION, type CompletionInput, type LlmProvider } from './llm-provider';

export class MistralProvider implements LlmProvider {
  readonly name = 'mistral' as const;
  private readonly client: Mistral | undefined;

  constructor(
    apiKey: string | undefined,
    readonly model: string,
  ) {
    this.client = apiKey ? new Mistral({ apiKey, retryConfig: { strategy: 'none' } }) : undefined;
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
