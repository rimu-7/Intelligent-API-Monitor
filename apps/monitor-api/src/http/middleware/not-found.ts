import type { RequestHandler } from 'express';
import { NotFoundError } from '../../lib/errors';

export const notFound: RequestHandler = (req) => {
  throw new NotFoundError(`Route ${req.method} ${req.path} not found`);
};
