import { TELEMETRY_LIMITS } from '@apimon/shared';
import { z } from 'zod';
import { PayloadTooLargeError, ValidationError } from '../../lib/errors';

export interface Envelope {
  items: unknown[];
  sourceDetail: string | null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Accepted ingestion bodies (§6.1): the PDF array, `{ logs: [...], source? }`, or a single item.
 * Anything else is INVALID_PAYLOAD; empty → EMPTY_BATCH; > maxBatch → BATCH_TOO_LARGE.
 */
export const parseEnvelope = (body: unknown, maxBatch: number): Envelope => {
  let items: unknown[];
  let sourceDetail: string | null = null;

  if (Array.isArray(body)) {
    items = body;
  } else if (isPlainObject(body) && 'logs' in body) {
    if (!Array.isArray(body.logs)) {
      throw new ValidationError(
        '"logs" must be an array',
        [{ path: 'logs', message: 'must be an array' }],
        'INVALID_PAYLOAD',
      );
    }
    items = body.logs;
    if (body.source !== undefined) {
      if (typeof body.source !== 'string' || body.source.trim().length === 0) {
        throw new ValidationError(
          '"source" must be a non-empty string',
          [{ path: 'source', message: 'must be a string' }],
          'INVALID_PAYLOAD',
        );
      }
      sourceDetail = body.source.trim().slice(0, TELEMETRY_LIMITS.sourceDetailMaxLength);
    }
  } else if (isPlainObject(body) && 'api_name' in body) {
    items = [body];
  } else {
    throw new ValidationError(
      'Body must be a telemetry array, { "logs": [...] } or a single telemetry object',
      undefined,
      'INVALID_PAYLOAD',
    );
  }

  if (items.length === 0) throw new ValidationError('The batch is empty', undefined, 'EMPTY_BATCH');
  if (items.length > maxBatch) {
    throw new PayloadTooLargeError(
      `The batch has ${items.length} items; the maximum is ${maxBatch}`,
      'BATCH_TOO_LARGE',
      {
        max_batch_size: maxBatch,
        received: items.length,
      },
    );
  }
  return { items, sourceDetail };
};

export const staticIngestBody = z.strictObject({
  file: z.string().min(1).max(100).default('sample-telemetry.json'),
});

export const fetchLiveBody = z.strictObject({
  count: z.number().int().min(1).max(500).default(10),
});

export const runsQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
