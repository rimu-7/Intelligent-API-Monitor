import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from '../logger';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound: RequestHandler = (req) => {
  throw new HttpError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`);
};

const hasType = (err: unknown, type: string) =>
  typeof err === 'object' && err !== null && 'type' in err && err.type === type;

export const createErrorHandler =
  (logger: Logger): ErrorRequestHandler =>
  (err, _req, res, _next) => {
    let error: HttpError;
    if (err instanceof HttpError) error = err;
    else if (hasType(err, 'entity.parse.failed'))
      error = new HttpError(400, 'INVALID_JSON', 'Malformed JSON body');
    else {
      logger.error({ err }, 'request failed');
      error = new HttpError(500, 'INTERNAL_ERROR', 'Something went wrong');
    }
    res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
  };
