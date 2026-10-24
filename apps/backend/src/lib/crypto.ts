import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

/**
 * Timing-safe string comparison. Both sides are hashed first because
 * `crypto.timingSafeEqual` throws on different lengths (A20, §21.12).
 */
export const safeEqual = (a: string, b: string): boolean =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** URL-safe random token (base64url). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
