import type {
  CompletionInput,
  LlmProvider,
  LlmProviderName,
} from '../../src/modules/ai/providers/llm-provider';

/** Deterministic stand-in for an LLM: returns (or throws) whatever `respond` produces. */
export class FakeProvider implements LlmProvider {
  calls: CompletionInput[] = [];

  constructor(
    readonly name: LlmProviderName,
    private readonly respond: (input: CompletionInput) => string | Promise<string>,
    readonly model = `${name}-fake-model`,
  ) {}

  isConfigured(): boolean {
    return true;
  }

  async complete(input: CompletionInput): Promise<string> {
    this.calls.push(input);
    return this.respond(input);
  }
}

export const failing = (name: LlmProviderName, message = 'HTTP 503 upstream unavailable') =>
  new FakeProvider(name, () => {
    throw Object.assign(new Error(message), { status: 503 });
  });

/** A grounded completion for whatever api/status/latency/records the prompt contains. */
export const groundedReply = (input: CompletionInput): string => {
  const data = JSON.parse(input.user.replace('<telemetry>', '').replace('</telemetry>', '')) as {
    api_name: string;
    status_code: number | null;
    response_time_ms: number | null;
  };
  return JSON.stringify({
    alert_message: `${data.api_name} returned HTTP ${data.status_code} after ${data.response_time_ms} ms; appointment workflows are likely failing.`,
    probable_cause: 'Likely a failing database connection pool in the service.',
    recommended_action:
      'Check the service error logs and database connection metrics, then restart unhealthy pods.',
  });
};
