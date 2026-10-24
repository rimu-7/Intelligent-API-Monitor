import type { Redis } from 'ioredis';
import type { Logger } from '../../infrastructure/logger';
import { CIRCUIT_HASH_KEY } from '../health/health.service';
import { CircuitBreaker, type CircuitState } from './circuit-breaker';
import type { LlmProvider } from './providers/llm-provider';

/**
 * One breaker per configured provider. Every transition is logged and written to the Redis hash
 * `ai:circuit` so the API's /health can report worker-side state (§9.4).
 */
export const createBreakers = (
  providers: readonly LlmProvider[],
  redis: Redis,
  logger: Logger,
): Map<string, CircuitBreaker> => {
  const report = (name: string, state: CircuitState, since: Date) => {
    logger.info({ event: 'ai.circuit.state_changed', provider: name, state }, `circuit ${name} → ${state}`);
    redis
      .hset(CIRCUIT_HASH_KEY, name, JSON.stringify({ state, since: since.toISOString() }))
      .catch((err: unknown) => logger.warn({ err }, 'circuit state write failed'));
  };
  return new Map(
    providers.map((provider) => [
      provider.name,
      new CircuitBreaker(provider.name, {
        onTransition: (state, since) => report(provider.name, state, since),
      }),
    ]),
  );
};

/** A restarted worker starts with closed breakers; make /health agree. */
export const publishInitialCircuitState = async (
  breakers: ReadonlyMap<string, CircuitBreaker>,
  redis: Redis,
): Promise<void> => {
  const now = new Date().toISOString();
  for (const [name, breaker] of breakers) {
    await redis.hset(CIRCUIT_HASH_KEY, name, JSON.stringify({ state: breaker.state, since: now }));
  }
};
