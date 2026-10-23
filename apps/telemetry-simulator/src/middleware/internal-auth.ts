import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { HttpError } from './error-handler';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Control endpoints require `x-internal-key` (compared timing-safely on sha256 digests). */
export const requireInternalKey =
  (expected: string): RequestHandler =>
  (req, _res, next) => {
    const provided = req.header('x-internal-key');
    if (provided === undefined || !timingSafeEqual(digest(provided), digest(expected))) {
      throw new HttpError(401, 'UNAUTHORIZED', 'A valid x-internal-key header is required');
    }
    next();
  };
