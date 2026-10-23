import { ERROR_STATUS, type ErrorCode } from '@apimon/shared';

export type ErrorDetails = Record<string, unknown> | unknown[];

/**
 * Base class for every error the API returns on purpose. The central error handler
 * turns it into `{ success: false, error: { code, message, details?, request_id } }`.
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetails,
    status?: number,
  ) {
    super(message);
    this.name = new.target.name;
    this.status = status ?? ERROR_STATUS[code];
  }
}

export class ValidationError extends AppError {
  constructor(
    message = 'Request validation failed',
    details?: ErrorDetails,
    code: Extract<
      ErrorCode,
      | 'VALIDATION_ERROR'
      | 'INVALID_ID'
      | 'INVALID_PAYLOAD'
      | 'EMPTY_BATCH'
      | 'INVALID_JSON'
      | 'UNKNOWN_SAMPLE_FILE'
    > = 'VALIDATION_ERROR',
  ) {
    super(code, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message = 'Authentication required',
    code: Extract<
      ErrorCode,
      'UNAUTHORIZED' | 'INVALID_CREDENTIALS' | 'TOKEN_EXPIRED' | 'REFRESH_RACE'
    > = 'UNAUTHORIZED',
  ) {
    super(code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super('FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(
    message: string,
    code: Extract<
      ErrorCode,
      'CONFLICT' | 'ALERT_ALREADY_RESOLVED' | 'IDEMPOTENCY_IN_PROGRESS' | 'LAST_ADMIN'
    > = 'CONFLICT',
  ) {
    super(code, message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(
    message: string,
    code: Extract<ErrorCode, 'PAYLOAD_TOO_LARGE' | 'BATCH_TOO_LARGE'>,
    details?: ErrorDetails,
  ) {
    super(code, message, details);
  }
}

export class UnprocessableError extends AppError {
  constructor(
    message: string,
    code: Extract<ErrorCode, 'ALL_ITEMS_REJECTED' | 'IDEMPOTENCY_KEY_REUSED'>,
    details?: ErrorDetails,
  ) {
    super(code, message, details);
  }
}

export class RateLimitedError extends AppError {
  constructor(
    readonly retryAfterSeconds: number,
    message = 'Too many requests, please try again later',
  ) {
    super('RATE_LIMITED', message, { retry_after_seconds: retryAfterSeconds });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(
    message = 'Service temporarily unavailable',
    code: Extract<ErrorCode, 'SERVICE_UNAVAILABLE' | 'SIMULATOR_UNAVAILABLE'> = 'SERVICE_UNAVAILABLE',
  ) {
    super(code, message);
  }
}
