import { describe, expect, it } from 'vitest';
import { randomToken, safeEqual, sha256Hex } from '../../src/lib/crypto';

describe('safeEqual', () => {
  it('compares equal strings as equal', () => {
    expect(safeEqual('secret-value', 'secret-value')).toBe(true);
  });

  it('rejects different strings, including different lengths (timingSafeEqual would throw)', () => {
    expect(safeEqual('secret-value', 'secret-valuf')).toBe(false);
    expect(safeEqual('short', 'a-much-longer-value')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });
});

describe('sha256Hex / randomToken', () => {
  it('produces 64 hex chars', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('produces distinct url-safe tokens', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(randomToken());
  });
});
