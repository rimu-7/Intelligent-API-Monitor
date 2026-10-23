/** Response envelopes and stable error codes (§11.1, §11.3). */

export const ERROR_STATUS = {
  INVALID_JSON: 400,
  INVALID_PAYLOAD: 400,
  EMPTY_BATCH: 400,
  VALIDATION_ERROR: 400,
  INVALID_ID: 400,
  UNKNOWN_SAMPLE_FILE: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  REFRESH_RACE: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ALERT_ALREADY_RESOLVED: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  LAST_ADMIN: 409,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  BATCH_TOO_LARGE: 413,
  ALL_ITEMS_REJECTED: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SIMULATOR_UNAVAILABLE: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

export interface ListMeta {
  total: number;
  limit: number;
  offset: number;
  [key: string]: unknown;
}

export interface ApiSuccess<T, M = undefined> {
  success: true;
  data: T;
  meta?: M;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    request_id: string;
  };
}

export type ApiResponse<T, M = undefined> = ApiSuccess<T, M> | ApiErrorBody;
