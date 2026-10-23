import { pino, type Logger } from 'pino';

export type { Logger };

export const createLogger = (level: string, appEnv: string): Logger =>
  pino({
    level,
    base: { service: 'telemetry-simulator', env: appEnv },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: ['req.headers["x-internal-key"]', 'req.headers["x-ingest-key"]', 'req.headers.authorization'],
      censor: '[REDACTED]',
    },
  });
