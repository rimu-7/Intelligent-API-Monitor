import { GoogleGenAI } from '@google/genai';
import { EmptyCompletionError, GENERATION, type CompletionInput, type LlmProvider } from './llm-provider';

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini' as const;
  private readonly client: GoogleGenAI | undefined;

  constructor(
    apiKey: string | undefined,
    readonly model: string,
  ) {
    // No SDK retries: the enrichment service owns failover and the circuit breaker.
    this.client = apiKey
      ? new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } })
      : undefined;
  }

  isConfigured(): boolean {
    return this.client !== undefined && this.model.length > 0;
  }

  async complete({ system, user, signal }: CompletionInput): Promise<string> {
    if (!this.client) throw new Error('gemini is not configured');
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: user,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        temperature: GENERATION.temperature,
        maxOutputTokens: GENERATION.maxOutputTokens,
        abortSignal: signal,
      },
    });
    const text = response.text;
    if (!text) throw new EmptyCompletionError(this.name);
    return text;
  }
}
