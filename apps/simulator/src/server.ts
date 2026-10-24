import { createSimulatorApp } from './app';
import { MonitorApiClient } from './clients/monitor-api.client';
import { loadSimulatorEnv } from './config/env';
import { TelemetryGenerator } from './generator/telemetry-generator';
import { createLogger } from './logger';
import { StreamController } from './streaming/stream-controller';

const env = loadSimulatorEnv();
const logger = createLogger(env.LOG_LEVEL, env.APP_ENV);
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection');
  process.exit(1);
});

const generator = new TelemetryGenerator(env.SIMULATOR_SEED);
const client = new MonitorApiClient(env.MONITOR_API_URL, env.INGEST_API_KEY, logger);
const stream = new StreamController(generator, client, env.STREAM_MAX_DURATION_MS, logger);
const app = createSimulatorApp({ generator, client, stream, internalKey: env.INTERNAL_SERVICE_KEY, logger });

const server = app.listen(env.LISTEN_PORT, () => {
  logger.info(
    { port: env.LISTEN_PORT, monitor_api: env.MONITOR_API_URL, seed: env.SIMULATOR_SEED },
    `telemetry-simulator listening on :${env.LISTEN_PORT}`,
  );
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  stream.stop('shutdown');
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
