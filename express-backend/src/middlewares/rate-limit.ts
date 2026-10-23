import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "../lib/redis.js";

const rateLimitedResponse = {
  success: false,
  error: { code: "TOO_MANY_REQUESTS", message: "Too many requests, please try again later" },
};

/**
 * Distributed brute-force rate limiter for the login endpoint backed by Redis.
 * Successful logins are not counted against the limit.
 */
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  limit: 10, // Max 10 failed login attempts per IP
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitedResponse,
  store: new RedisStore({
    // @ts-expect-error ioredis sendCommand type signature compatibility
    sendCommand: (...args: string[]) => redis.call(...args),
    prefix: "ams:rl:login:",
  }),
});

/**
 * Distributed general API rate limiter backed by Redis.
 * Allows 120 requests per minute per IP address.
 */
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitedResponse,
  store: new RedisStore({
    // @ts-expect-error ioredis sendCommand type signature compatibility
    sendCommand: (...args: string[]) => redis.call(...args),
    prefix: "ams:rl:api:",
  }),
});
