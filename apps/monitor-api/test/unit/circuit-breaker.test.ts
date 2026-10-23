import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, type CircuitState } from '../../src/modules/ai/circuit-breaker';

describe('circuit breaker (§9.4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens after 3 consecutive failures and reports transitions', () => {
    const transitions: CircuitState[] = [];
    const breaker = new CircuitBreaker('gemini', { onTransition: (state) => transitions.push(state) });
    for (let i = 0; i < 2; i += 1) {
      expect(breaker.tryAcquire()).toBe(true);
      breaker.recordFailure();
    }
    expect(breaker.state).toBe('CLOSED');
    breaker.tryAcquire();
    breaker.recordFailure();
    expect(breaker.state).toBe('OPEN');
    expect(breaker.tryAcquire()).toBe(false);
    expect(transitions).toEqual(['OPEN']);
  });

  it('resets the failure count on success', () => {
    const breaker = new CircuitBreaker('openai');
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe('CLOSED');
  });

  it('moves to HALF_OPEN after 60 s and allows exactly one trial', () => {
    const breaker = new CircuitBreaker('mistral');
    for (let i = 0; i < 3; i += 1) breaker.recordFailure();
    vi.advanceTimersByTime(59_999);
    expect(breaker.tryAcquire()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.state).toBe('HALF_OPEN');
    expect(breaker.tryAcquire()).toBe(false);
  });

  it('closes on a successful trial and re-opens on a failed one', () => {
    const transitions: CircuitState[] = [];
    const breaker = new CircuitBreaker('gemini', { onTransition: (state) => transitions.push(state) });
    for (let i = 0; i < 3; i += 1) breaker.recordFailure();
    vi.advanceTimersByTime(60_000);
    breaker.tryAcquire();
    breaker.recordFailure();
    expect(breaker.state).toBe('OPEN');
    expect(breaker.tryAcquire()).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(breaker.tryAcquire()).toBe(true);
    breaker.recordSuccess();
    expect(breaker.state).toBe('CLOSED');
    expect(transitions).toEqual(['OPEN', 'HALF_OPEN', 'OPEN', 'HALF_OPEN', 'CLOSED']);
  });
});
