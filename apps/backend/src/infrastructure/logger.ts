import { createRequire } from 'node:module';
import { pino, type Logger, type LoggerOptions } from 'pino';
import { APP_VERSION } from '../lib/version';

export type { Logger };

/** Never log credentials, tokens, cookies or keys (§16.1, A17). Request bodies are never logged. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-ingest-key"]',
  'req.headers["x-internal-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.new_password',
  '*.current_password',
  '*.access_token',
  '*.refresh_token',
  '*.ticket',
  '*.apiKey',
];

export interface LoggerConfig {
  level: string;
  appEnv: string;
  service: string;
}

const prettyAvailable = (): boolean => {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
};

export const createLogger = ({ level, appEnv, service }: LoggerConfig): Logger => {
  const options: LoggerOptions = {
    level,
    base: { service, env: appEnv, version: APP_VERSION },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: { level: (label) => ({ level: label }) },
  };

  // Pretty output only for a human at a terminal in development (pino-pretty is a dev dependency).
  if (appEnv === 'development' && process.stdout.isTTY && prettyAvailable()) {
    return pino({
      ...options,
      formatters: {},
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } },
    });
  }
  return pino(options);
};
