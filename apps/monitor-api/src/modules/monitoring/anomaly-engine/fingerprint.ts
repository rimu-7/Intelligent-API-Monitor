import type { AnomalyCode } from '@apimon/shared';
import { createHash } from 'node:crypto';

/**
 * Incident identity (§7.3): sha256hex(apiName + "|" + codes sorted alphabetically).
 * Severity is deliberately excluded so an incident can escalate in place; a different
 * symptom set for the same API is a different incident.
 */
export const fingerprint = (apiName: string, codes: readonly AnomalyCode[]): string =>
  createHash('sha256')
    .update(`${apiName}|${[...codes].sort().join(',')}`)
    .digest('hex');
