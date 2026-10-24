export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/** Rejects with TimeoutError if `promise` does not settle within `ms`. The timer never keeps the process alive. */
export const withTimeout = <T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
