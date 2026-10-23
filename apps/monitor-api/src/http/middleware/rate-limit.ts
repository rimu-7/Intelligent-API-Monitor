import type { Request, RequestHandler, Response } from 'express';
import type { Redis } from 'ioredis';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import type { Logger } from '../../infrastructure/logger';
import { RateLimitedError } from '../../lib/errors';

export interface LimiterConfig {
  keyPrefix: string;
  points: number;
  /** Window in seconds. */
  duration: number;
  /** Seconds to block once points are exhausted (0 = until the window ends). */
  blockDuration?: number;
}

/**
 * Redis-backed limiter with an in-memory insurance limiter that takes over while Redis is
 * unavailable (§16.3), so rate limiting fails closed-ish instead of open.
 */
export const createLimiter = (redis: Redis, config: LimiterConfig): RateLimiterRedis =>
  new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: `rl:${config.keyPrefix}`,
    points: config.points,
    duration: config.duration,
    blockDuration: config.blockDuration ?? 0,
    rejectIfRedisNotReady: true,
    insuranceLimiter: new RateLimiterMemory({
      keyPrefix: `rl-mem:${config.keyPrefix}`,
      points: config.points,
      duration: config.duration,
      blockDuration: config.blockDuration ?? 0,
    }),
  });

export const retryAfterSeconds = (res: RateLimiterRes): number =>
  Math.max(1, Math.ceil(res.msBeforeNext / 1000));

const setHeaders = (res: Response, limit: number, result: RateLimiterRes) => {
  res.setHeader('RateLimit-Limit', String(limit));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, result.remainingPoints)));
  res.setHeader('RateLimit-Reset', String(retryAfterSeconds(result)));
};

export interface RateLimitOptions {
  limiter: RateLimiterRedis;
  points: number;
  key: (req: Request) => string;
  skip?: (req: Request) => boolean;
  logger: Logger;
}

/** Consumes one point per request; 429 RATE_LIMITED with Retry-After when exhausted. */
export const rateLimit =
  ({ limiter, points, key, skip, logger }: RateLimitOptions): RequestHandler =>
  async (req, res, next) => {
    if (skip?.(req)) return next();
    try {
      setHeaders(res, points, await limiter.consume(key(req)));
    } catch (rejection) {
      if (rejection instanceof RateLimiterRes) {
        setHeaders(res, points, rejection);
        throw new RateLimitedError(retryAfterSeconds(rejection));
      }
      // Both stores failed: let the request through rather than take the API down.
      logger.error({ err: rejection }, 'rate limiter unavailable');
    }
    next();
  };

/** Client IP as Express resolved it (honours TRUST_PROXY). */
export const clientIp = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';
