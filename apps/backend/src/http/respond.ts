import type { Response } from 'express';

/** Success envelope `{ success: true, data, meta? }` (§11.1). */
export const ok = (res: Response, data: unknown, options: { status?: number; meta?: object } = {}): void => {
  res
    .status(options.status ?? 200)
    .json(options.meta ? { success: true, data, meta: options.meta } : { success: true, data });
};
