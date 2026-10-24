import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { MonitorApiClient } from './clients/monitor-api.client';
import type { TelemetryGenerator } from './generator/telemetry-generator';
import type { Logger } from './logger';
import { createErrorHandler, notFound } from './middleware/error-handler';
import { requireInternalKey } from './middleware/internal-auth';
import { healthRoutes } from './routes/health.routes';
import { scenarioRoutes } from './routes/scenarios.routes';
import { streamRoutes } from './routes/stream.routes';
import { telemetryRoutes } from './routes/telemetry.routes';
import type { StreamController } from './streaming/stream-controller';

export interface SimulatorDeps {
  generator: TelemetryGenerator;
  client: Pick<MonitorApiClient, 'push'>;
  stream: StreamController;
  internalKey: string;
  logger: Logger;
}

/** Builds the simulator app without listening (tests drive it directly). */
export const createSimulatorApp = (deps: SimulatorDeps): Express => {
  const app = express();
  const startedAt = Date.now();
  const auth = requireInternalKey(deps.internalKey);

  app.disable('x-powered-by');
  app.use(pinoHttp({ logger: deps.logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  app.use(express.json({ limit: '64kb' }));

  app.use(healthRoutes(deps.stream, startedAt));
  app.use(telemetryRoutes(deps.generator));
  app.use(scenarioRoutes({ generator: deps.generator, client: deps.client, auth }));
  app.use(streamRoutes(deps.stream, auth));

  app.use(notFound);
  app.use(createErrorHandler(deps.logger));
  return app;
};
