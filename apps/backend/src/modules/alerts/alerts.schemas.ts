import { ANOMALY_CODES, API_NAME_PATTERN, SEVERITIES } from '@apimon/shared';
import { z } from 'zod';

/** Query objects are tolerant of unknown keys (cache busters); bodies are strict. */
export const listAlertsQuery = z.object({
  status: z.enum(['ACTIVE', 'RESOLVED', 'ALL']).default('ACTIVE'),
  severity: z.enum(SEVERITIES).optional(),
  api_name: z.string().regex(API_NAME_PATTERN, 'invalid api_name').optional(),
  anomaly_type: z.enum(ANOMALY_CODES).optional(),
  sort: z.enum(['last_seen_at', 'severity']).default('last_seen_at'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export const alertIdParams = z.strictObject({ id: z.uuid() });

export const resolveAlertBody = z.strictObject({
  note: z.string().trim().min(1).max(500).optional(),
});

export type ListAlertsInput = z.output<typeof listAlertsQuery>;
