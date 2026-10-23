import { Router } from 'express';
import type { StreamController } from '../streaming/stream-controller';

export const healthRoutes = (stream: StreamController, startedAt: number): Router =>
  Router().get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      streaming: stream.streaming,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
    });
  });
