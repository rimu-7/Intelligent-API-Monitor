import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

const LOCKOUT_THRESHOLD = 5; // 5 failed attempts
const LOCKOUT_DURATION_SECONDS = 15 * 60; // 15 minutes
const ATTEMPTS_WINDOW_SECONDS = 15 * 60; // 15 minutes window
const DEFAULT_BLACKLIST_TTL = 7 * 24 * 60 * 60; // 7 days (matches session max age)

const createRedisClient = (): Redis => {
  const commonOptions = {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 150, 3000);
      return delay;
    },
  };

  if (env.REDIS_URL) {
    return new Redis(env.REDIS_URL, commonOptions);
  }

  return new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    ...commonOptions,
  });
};

export const redis = createRedisClient();

redis.on("connect", () => {
  logger.info("🔌 Redis client connecting...");
});

redis.on("ready", () => {
  logger.info("✅ Redis connected and ready for requests");
});

redis.on("error", (err: Error) => {
  logger.error({ err: err.message }, "❌ Redis error encountered");
});

redis.on("close", () => {
  logger.warn("⚠️ Redis connection closed");
});

/** Tests Redis connectivity and reports latency in milliseconds */
export const checkRedisConnection = async (): Promise<number> => {
  const start = Date.now();
  if (redis.status === "wait" || redis.status === "end") {
    await redis.connect();
  }
  const pong = await redis.ping();
  if (pong !== "PONG") {
    throw new Error(`Unexpected Redis ping response: ${pong}`);
  }
  return Date.now() - start;
};

/** Closes Redis connection cleanly */
export const closeRedis = async (): Promise<void> => {
  if (redis.status === "ready" || redis.status === "connecting") {
    await redis.quit().catch(() => redis.disconnect());
  }
};

/** Returns detailed Redis health and memory metrics */
export const getRedisMetrics = async () => {
  try {
    const latencyMs = await checkRedisConnection();
    const info = await redis.info("memory");
    const memoryMatch = info.match(/used_memory_human:(.+)/);
    const memoryUsed = memoryMatch ? memoryMatch[1]?.trim() : "unknown";

    return {
      status: "up",
      connected: true,
      latencyMs,
      memoryUsed,
    };
  } catch (error) {
    return {
      status: "down",
      connected: false,
      error: (error as Error).message,
    };
  }
};

/* ==========================================================================
   Redis-Powered Security: Account Lockout & Brute-Force Shield
   ========================================================================== */

const sanitizeIdentifier = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");

/**
 * Checks if a username or IP address is currently locked out due to brute force attacks.
 */
export const checkAccountLockout = async (
  username: string,
  ip: string,
): Promise<{ locked: boolean; remainingSeconds: number; reason?: string }> => {
  try {
    const userLockKey = `ams:lockout:user:${sanitizeIdentifier(username)}`;
    const ipLockKey = `ams:lockout:ip:${sanitizeIdentifier(ip)}`;

    const [userTtl, ipTtl] = await Promise.all([redis.ttl(userLockKey), redis.ttl(ipLockKey)]);

    if (userTtl > 0) {
      return {
        locked: true,
        remainingSeconds: userTtl,
        reason: "Account is temporarily locked due to repeated failed logins",
      };
    }

    if (ipTtl > 0) {
      return {
        locked: true,
        remainingSeconds: ipTtl,
        reason: "IP address is temporarily blocked due to repeated failed logins",
      };
    }

    return { locked: false, remainingSeconds: 0 };
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "Redis lockout check fallback to allow");
    return { locked: false, remainingSeconds: 0 };
  }
};

/**
 * Records a failed login attempt for both username and IP.
 * Triggers temporary lockout if threshold is exceeded.
 */
export const recordFailedLogin = async (
  username: string,
  ip: string,
): Promise<{ attempts: number; locked: boolean; remainingSeconds: number }> => {
  try {
    const sanitizedUser = sanitizeIdentifier(username);
    const sanitizedIp = sanitizeIdentifier(ip);

    const userAttemptsKey = `ams:attempts:user:${sanitizedUser}`;
    const userLockKey = `ams:lockout:user:${sanitizedUser}`;

    const ipAttemptsKey = `ams:attempts:ip:${sanitizedIp}`;
    const ipLockKey = `ams:lockout:ip:${sanitizedIp}`;

    const multi = redis.multi();
    multi.incr(userAttemptsKey);
    multi.expire(userAttemptsKey, ATTEMPTS_WINDOW_SECONDS);
    multi.incr(ipAttemptsKey);
    multi.expire(ipAttemptsKey, ATTEMPTS_WINDOW_SECONDS);

    const results = await multi.exec();
    const userAttempts = (results?.[0]?.[1] as number) ?? 1;
    const ipAttempts = (results?.[2]?.[1] as number) ?? 1;

    const maxAttempts = Math.max(userAttempts, ipAttempts);

    if (maxAttempts >= LOCKOUT_THRESHOLD) {
      await Promise.all([
        redis.set(userLockKey, "locked", "EX", LOCKOUT_DURATION_SECONDS),
        redis.set(ipLockKey, "locked", "EX", LOCKOUT_DURATION_SECONDS),
      ]);

      logger.warn(
        { username, ip, attempts: maxAttempts },
        "🚨 Account/IP locked due to excessive failed login attempts",
      );

      return { attempts: maxAttempts, locked: true, remainingSeconds: LOCKOUT_DURATION_SECONDS };
    }

    return { attempts: maxAttempts, locked: false, remainingSeconds: 0 };
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "Redis record failed login error");
    return { attempts: 1, locked: false, remainingSeconds: 0 };
  }
};

/**
 * Clears failed attempts and lockouts after a successful login.
 */
export const clearAccountLockout = async (username: string, ip: string): Promise<void> => {
  try {
    const sanitizedUser = sanitizeIdentifier(username);
    const sanitizedIp = sanitizeIdentifier(ip);

    await redis.del(
      `ams:attempts:user:${sanitizedUser}`,
      `ams:lockout:user:${sanitizedUser}`,
      `ams:attempts:ip:${sanitizedIp}`,
      `ams:lockout:ip:${sanitizedIp}`,
    );
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "Failed to clear account lockout in Redis");
  }
};

/* ==========================================================================
   Redis-Powered Security: Token Blacklist & Session Invalidation
   ========================================================================== */

/**
 * Adds a session token to the Redis blacklist with a TTL.
 */
export const blacklistToken = async (token: string, ttlSeconds = DEFAULT_BLACKLIST_TTL): Promise<void> => {
  try {
    await redis.set(`ams:token:blacklist:${token}`, "revoked", "EX", ttlSeconds);
  } catch (error) {
    logger.error({ err: (error as Error).message }, "Failed to blacklist token in Redis");
  }
};

/**
 * Checks if a token is in the Redis blacklist (O(1)).
 */
export const isTokenBlacklisted = async (token: string): Promise<boolean> => {
  try {
    const exists = await redis.exists(`ams:token:blacklist:${token}`);
    return exists === 1;
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "Failed to check token blacklist, fallback false");
    return false;
  }
};

/**
 * Purges all cached session keys for a specific user.
 * Used when an admin bans a user, updates their role, or deletes their account.
 */
export const purgeUserSessions = async (userId: string): Promise<void> => {
  try {
    // Scan and remove any Better Auth secondaryStorage keys or user cache
    const stream = redis.scanStream({
      match: `ams:auth:*`,
      count: 100,
    });

    const keysToDelete: string[] = [];

    stream.on("data", async (keys: string[]) => {
      for (const key of keys) {
        try {
          const val = await redis.get(key);
          if (val && val.includes(userId)) {
            keysToDelete.push(key);
          }
        } catch {
          // ignore scan errors
        }
      }
    });

    await new Promise<void>((resolve) => {
      stream.on("end", async () => {
        if (keysToDelete.length > 0) {
          await redis.del(...keysToDelete);
          logger.info({ userId, count: keysToDelete.length }, "🧹 Purged user sessions from Redis cache");
        }
        resolve();
      });
      stream.on("error", () => resolve());
    });
  } catch (error) {
    logger.warn({ err: (error as Error).message, userId }, "Failed to purge user sessions from Redis");
  }
};
