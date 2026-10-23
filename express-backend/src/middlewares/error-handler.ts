import { APIError as BetterAuthError } from "better-auth/api";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { isProduction } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { ApiError } from "../utils/api-error.js";

const PG_UNIQUE_VIOLATION = "23505";

const toApiError = (err: unknown): ApiError => {
  if (err instanceof ApiError) return err;

  if (err instanceof BetterAuthError) {
    const body = (err.body ?? {}) as { code?: string; message?: string };
    return new ApiError(err.statusCode, body.code ?? String(err.status), body.message ?? err.message);
  }

  // Malformed JSON body (from express.json)
  if (err instanceof SyntaxError && "type" in err && err.type === "entity.parse.failed") {
    return ApiError.badRequest("Malformed JSON body");
  }
  if (typeof err === "object" && err !== null && "type" in err && err.type === "entity.too.large") {
    return new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }

  // Unique constraint race (e.g. two admins creating the same username at once).
  // Drizzle wraps driver errors, so check the error and its cause.
  const pgError = [err, (err as { cause?: unknown })?.cause].find(
    (e): e is { code: string } =>
      typeof e === "object" && e !== null && (e as { code?: unknown }).code === PG_UNIQUE_VIOLATION,
  );
  if (pgError) return ApiError.conflict("A record with these details already exists");

  return new ApiError(500, "INTERNAL_SERVER_ERROR", "Something went wrong");
};

export const notFoundHandler: RequestHandler = (req) => {
  throw ApiError.notFound(`Route ${req.method} ${req.path} not found`);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const apiError = toApiError(err);

  if (apiError.statusCode >= 500) {
    (req.log ?? logger).error({ err }, "Unhandled error");
  }

  res.status(apiError.statusCode).json({
    success: false,
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details ? { details: apiError.details } : {}),
      ...(!isProduction && apiError.statusCode >= 500 && err instanceof Error
        ? {
            cause: err.cause instanceof Error ? err.cause.message : undefined,
            stack: err.stack,
          }
        : {}),
    },
  });
};
