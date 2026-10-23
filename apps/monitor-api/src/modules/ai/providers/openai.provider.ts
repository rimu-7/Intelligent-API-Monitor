import OpenAI from 'openai';
import { EmptyCompletionError, GENERATION, type CompletionInput, type LlmProvider } from './llm-provider';

export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai' as const;
  private readonly client: OpenAI | undefined;

  constructor(
    apiKey: string | undefined,
    readonly model: string,
  ) {
    this.client = apiKey ? new OpenAI({ apiKey, maxRetries: 0 }) : undefined;
  }

  isConfigured(): boolean {
    return this.client !== undefined && this.model.length > 0;
  }

  async complete({ system, user, signal }: CompletionInput): Promise<string> {
    if (!this.client) throw new Error('openai is not configured');
    const completion = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        temperature: GENERATION.temperature,
        max_completion_tokens: GENERATION.maxOutputTokens,
      },
      { signal },
    );
    const text = completion.choices[0]?.message.content;
    if (!text) throw new EmptyCompletionError(this.name);
    return text;
  }
}
