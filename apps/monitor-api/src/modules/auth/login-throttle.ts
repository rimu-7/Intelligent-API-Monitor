import type { Redis } from 'ioredis';
import { RateLimiterRes, type RateLimiterRedis } from 'rate-limiter-flexible';
import { createLimiter, retryAfterSeconds } from '../../http/middleware/rate-limit';
import type { Logger } from '../../infrastructure/logger';
import { sha256Hex } from '../../lib/crypto';
import { RateLimitedError } from '../../lib/errors';

const WINDOW_SECONDS = 15 * 60;
const IP_ATTEMPTS = 20;
const EMAIL_CONSECUTIVE_FAILURES = 5;

/**
 * Brute-force protection per IP and per account, stored in Redis with in-memory insurance
 * (§12.5, A4). Ported from the original module's lockout shield; IP and account counters are
 * now independent so one noisy account no longer locks out its whole IP.
 *
 * The account key is a hash of the submitted email whether or not the account exists, so
 * blocking reveals nothing about which emails are registered.
 */
export class LoginThrottle {
  private readonly ipLimiter: RateLimiterRedis;
  private readonly emailLimiter: RateLimiterRedis;

  constructor(
    redis: Redis,
    private readonly logger: Logger,
  ) {
    this.ipLimiter = createLimiter(redis, {
      keyPrefix: 'login:ip',
      points: IP_ATTEMPTS,
      duration: WINDOW_SECONDS,
    });
    this.emailLimiter = createLimiter(redis, {
      keyPrefix: 'login:email',
      points: EMAIL_CONSECUTIVE_FAILURES,
      duration: WINDOW_SECONDS,
      blockDuration: WINDOW_SECONDS,
    });
  }

  private emailKey(email: string): string {
    return sha256Hex(email);
  }

  /** Counts the attempt against the IP and refuses blocked emails. Throws 429 with Retry-After. */
  async beforeAttempt(ip: string, email: string): Promise<void> {
    try {
      const existing = await this.emailLimiter.get(this.emailKey(email));
      if (existing && existing.consumedPoints >= EMAIL_CONSECUTIVE_FAILURES) {
        throw new RateLimitedError(
          retryAfterSeconds(existing),
          'Too many failed login attempts, try again later',
        );
      }
      await this.ipLimiter.consume(ip);
    } catch (error) {
      if (error instanceof RateLimitedError) throw error;
      if (error instanceof RateLimiterRes) {
        throw new RateLimitedError(retryAfterSeconds(error), 'Too many login attempts, try again later');
      }
      this.logger.error({ err: error }, 'login throttle unavailable');
    }
  }

  async recordFailure(email: string): Promise<void> {
    try {
      await this.emailLimiter.consume(this.emailKey(email));
    } catch (error) {
      // Reaching the limit rejects with RateLimiterRes; the next attempt is refused in beforeAttempt.
      if (!(error instanceof RateLimiterRes)) this.logger.error({ err: error }, 'login throttle unavailable');
    }
  }

  async recordSuccess(email: string): Promise<void> {
    try {
      await this.emailLimiter.delete(this.emailKey(email));
    } catch (error) {
      this.logger.error({ err: error }, 'login throttle unavailable');
    }
  }
}
