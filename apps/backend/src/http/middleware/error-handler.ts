import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import {
  AppError,
  ConflictError,
  PayloadTooLargeError,
  RateLimitedError,
  ServiceUnavailableError,
  ValidationError,
} from '../../lib/errors';
import { pgErrorCode } from '../../lib/retry';

const hasType = (err: unknown, type: string): boolean =>
  typeof err === 'object' && err !== null && 'type' in err && err.type === type;

const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE']);

/** pg connection failures, admin shutdowns and Redis outages all mean "try again later". */
const isInfrastructureOutage = (err: unknown): boolean => {
  const sqlState = pgErrorCode(err);
  if (sqlState && (sqlState.startsWith('08') || sqlState === '57P01' || sqlState === '57P03')) return true;
  for (let current: unknown = err, depth = 0; current && depth < 4; depth += 1) {
    if (typeof current !== 'object') break;
    const { code, name, message } = current as { code?: unknown; name?: unknown; message?: unknown };
    if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) return true;
    if (name === 'MaxRetriesPerRequestError') return true;
    if (
      typeof message === 'string' &&
      /Connection is closed|connection terminated|timeout exceeded when trying to connect/i.test(message)
    ) {
      return true;
    }
    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
};

/** Maps anything thrown into an AppError. Unknown errors become a generic 500 (A18). */
export const toAppError = (err: unknown): AppError => {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new ValidationError(
      'Request validation failed',
      err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  if (hasType(err, 'entity.parse.failed'))
    return new ValidationError('Malformed JSON body', undefined, 'INVALID_JSON');
  if (hasType(err, 'entity.too.large')) {
    return new PayloadTooLargeError('Request body is too large', 'PAYLOAD_TOO_LARGE');
  }
  if (hasType(err, 'encoding.unsupported') || hasType(err, 'charset.unsupported')) {
    return new ValidationError('Unsupported request body encoding', undefined, 'INVALID_PAYLOAD');
  }
  if (pgErrorCode(err) === '23505') return new ConflictError('A record with these details already exists');
  if (isInfrastructureOutage(err)) return new ServiceUnavailableError();
  return new AppError('INTERNAL_ERROR', 'Something went wrong');
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = toAppError(err);

  if (appError.status >= 500) {
    // Stack traces go to logs only, never to the client.
    req.log.error({ err, code: appError.code }, 'request failed');
  }

  if (res.headersSent) {
    // Streaming responses (SSE) cannot change status once started.
    res.end();
    return;
  }

  if (appError instanceof RateLimitedError) {
    res.setHeader('Retry-After', String(appError.retryAfterSeconds));
  }

  res.status(appError.status).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details === undefined ? {} : { details: appError.details }),
      request_id: req.requestId,
    },
  });
};
