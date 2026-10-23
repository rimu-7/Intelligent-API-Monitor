import { Router } from 'express';
import { z } from 'zod';
import type { TelemetryGenerator } from '../generator/telemetry-generator';
import { HttpError } from '../middleware/error-handler';

const query = z.object({ count: z.coerce.number().int().min(1).max(500).default(10) });

/** Public, read-only: a batch of synthetic telemetry in the PDF item shape. */
export const telemetryRoutes = (generator: TelemetryGenerator): Router =>
  Router().get('/api/telemetry', (req, res) => {
    const parsed = query.safeParse(req.query);
    if (!parsed.success)
      throw new HttpError(400, 'VALIDATION_ERROR', 'count must be an integer between 1 and 500');
    res.json({ success: true, data: generator.batch(parsed.data.count) });
  });
