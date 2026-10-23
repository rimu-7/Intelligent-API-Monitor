import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../middleware/error-handler';
import type { StreamController } from '../streaming/stream-controller';

const startBody = z.strictObject({
  interval_ms: z.number().int().min(500).max(60_000).default(2_000),
  batch_size: z.number().int().min(1).max(100).default(10),
});

export const streamRoutes = (stream: StreamController, auth: RequestHandler): Router =>
  Router()
    .post('/api/stream/start', auth, (req, res) => {
      const parsed = startBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'interval_ms must be 500–60000 and batch_size 1–100');
      }
      res.json({
        success: true,
        data: stream.start({ intervalMs: parsed.data.interval_ms, batchSize: parsed.data.batch_size }),
      });
    })
    .post('/api/stream/stop', auth, (_req, res) => {
      res.json({ success: true, data: stream.stop() });
    })
    .get('/api/stream/status', auth, (_req, res) => {
      res.json({ success: true, data: stream.getStatus() });
    });
