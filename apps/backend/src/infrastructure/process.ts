import type { Logger } from './logger';

/** Crash loudly on programming errors; Docker restarts the container (§16.1). */
export const installCrashHandlers = (logger: Logger): void => {
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
};

/** Runs `shutdown` once on SIGTERM/SIGINT; forces exit after `forceAfterMs`. */
export const onShutdownSignal = (
  logger: Logger,
  shutdown: () => Promise<void>,
  forceAfterMs = 15_000,
): void => {
  let started = false;
  const handler = (signal: NodeJS.Signals) => {
    if (started) return;
    started = true;
    logger.info({ signal }, 'shutdown requested');
    setTimeout(() => {
      logger.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, forceAfterMs).unref();
    shutdown()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        logger.error({ err }, 'shutdown failed');
        process.exit(1);
      });
  };
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
};
