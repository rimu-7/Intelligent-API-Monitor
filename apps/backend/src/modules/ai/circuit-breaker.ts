export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  openMs?: number;
  now?: () => number;
  onTransition?: (state: CircuitState, since: Date) => void;
}

/**
 * One breaker per provider (§9.4): CLOSED → OPEN after 3 consecutive failures; OPEN for 60 s →
 * HALF_OPEN allows one trial call; success closes, failure re-opens. State lives in the worker
 * process; transitions are reported through `onTransition` (written to Redis for /health).
 */
export class CircuitBreaker {
  private current: CircuitState = 'CLOSED';
  private failures = 0;
  private openedAt = 0;
  private trialInFlight = false;
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly now: () => number;

  constructor(
    readonly name: string,
    private readonly options: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.openMs = options.openMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  get state(): CircuitState {
    return this.current;
  }

  /** True if a call may be attempted now. Moving OPEN → HALF_OPEN reserves the single trial. */
  tryAcquire(): boolean {
    if (this.current === 'CLOSED') return true;
    if (this.current === 'OPEN') {
      if (this.now() - this.openedAt < this.openMs) return false;
      this.transition('HALF_OPEN');
    }
    if (this.trialInFlight) return false;
    this.trialInFlight = true;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.trialInFlight = false;
    if (this.current !== 'CLOSED') this.transition('CLOSED');
  }

  recordFailure(): void {
    this.trialInFlight = false;
    if (this.current === 'HALF_OPEN') {
      this.open();
      return;
    }
    this.failures += 1;
    if (this.current === 'CLOSED' && this.failures >= this.failureThreshold) this.open();
  }

  private open(): void {
    this.openedAt = this.now();
    this.transition('OPEN');
  }

  private transition(state: CircuitState): void {
    this.current = state;
    if (state === 'CLOSED') this.failures = 0;
    this.options.onTransition?.(state, new Date(this.now()));
  }
}
