import { API_NAME_PATTERN } from '@apimon/shared';
import { z } from 'zod';

const latency = z.number().int().min(1).max(600_000).nullable();

/** Both thresholds null (= use defaults) or both set with critical > warning (§7.5). */
export const updateThresholdsBody = z
  .strictObject({
    latency_warning_ms: latency,
    latency_critical_ms: latency,
    expects_records: z.boolean().optional(),
  })
  .superRefine((body, ctx) => {
    const { latency_warning_ms: warning, latency_critical_ms: critical } = body;
    if ((warning === null) !== (critical === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['latency_critical_ms'],
        message: 'set both thresholds, or both to null',
      });
    } else if (warning !== null && critical !== null && critical <= warning) {
      ctx.addIssue({
        code: 'custom',
        path: ['latency_critical_ms'],
        message: 'must be greater than latency_warning_ms',
      });
    }
  });

export const apiNameParams = z.strictObject({ name: z.string().regex(API_NAME_PATTERN) });

export type UpdateThresholdsInput = z.output<typeof updateThresholdsBody>;
