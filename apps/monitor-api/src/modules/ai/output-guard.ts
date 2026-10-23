import { z } from 'zod';
import type { AlertText } from './template-alert';
import type { PromptInput } from './alert-prompt';

export type GuardRejection = 'NOT_JSON' | 'INVALID_SHAPE' | 'MISSING_API_NAME' | 'UNGROUNDED_NUMBER';
export type GuardResult =
  { ok: true; text: AlertText } | { ok: false; reason: GuardRejection; detail?: string };

/** Trim, collapse whitespace, strip markdown symbols (*, `, leading #). */
const clean = (value: string) =>
  value
    .replace(/[*`]/g, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();

const field = (min: number, max: number) => z.string().transform(clean).pipe(z.string().min(min).max(max));

const outputSchema = z.strictObject({
  alert_message: field(20, 300),
  probable_cause: field(10, 300),
  recommended_action: field(10, 400),
});

/** Strips ``` fences and returns the first balanced {...} object, or null. */
export const extractJsonObject = (raw: string): string | null => {
  const text = raw.replace(/```(?:json)?/gi, '');
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

const NUMBER_TOKEN = /\d[\d,]*(?:\.\d+)?/g;
const numbersIn = (text: string): number[] =>
  (text.match(NUMBER_TOKEN) ?? []).map((token) => Number(token.replace(/,/g, ''))).filter(Number.isFinite);

/** Every number in the input JSON, plus each latency value in seconds (5500 → 5.5). */
export const allowedNumbers = (input: PromptInput): Set<number> => {
  const allowed = new Set(numbersIn(JSON.stringify(input)));
  for (const ms of [
    input.response_time_ms,
    input.thresholds.latency_warning_ms,
    input.thresholds.latency_critical_ms,
  ]) {
    if (ms !== null) allowed.add(ms / 1000);
  }
  return allowed;
};

/**
 * LLM output is untrusted (§9.5, §21.17). A rejection means "try the next provider".
 */
export const guardOutput = (raw: string, input: PromptInput): GuardResult => {
  const json = extractJsonObject(raw);
  if (json === null) return { ok: false, reason: 'NOT_JSON' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'NOT_JSON' };
  }

  const result = outputSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: 'INVALID_SHAPE',
      detail: result.error.issues.map((i) => i.path.join('.') || i.message).join(', '),
    };
  }
  const output = result.data;

  if (!output.alert_message.includes(input.api_name)) return { ok: false, reason: 'MISSING_API_NAME' };

  const allowed = allowedNumbers(input);
  const ungrounded = numbersIn(output.alert_message).filter((n) => !allowed.has(n));
  if (ungrounded.length > 0) return { ok: false, reason: 'UNGROUNDED_NUMBER', detail: ungrounded.join(', ') };

  return {
    ok: true,
    text: {
      alertMessage: output.alert_message,
      probableCause: output.probable_cause,
      recommendedAction: output.recommended_action,
    },
  };
};
