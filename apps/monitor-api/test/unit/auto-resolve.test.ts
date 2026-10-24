import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/infrastructure/logger';
import { autoResolve } from '../../src/jobs/auto-resolve.processor';
import type { EventBus } from '../../src/modules/realtime/event-bus';
import { makeEnv } from '../helpers/env-fixtures';

describe('auto-resolve', () => {
  it('is off by default: only a signed-in user resolves incidents', () => {
    expect(makeEnv({ ALERT_AUTO_RESOLVE_MINUTES: undefined }).ALERT_AUTO_RESOLVE_MINUTES).toBe(0);
  });

  it('never touches incidents when disabled', async () => {
    const autoResolveInactive = vi.fn();
    const publish = vi.fn();
    const resolved = await autoResolve({
      alerts: { autoResolveInactive },
      events: { publish } as unknown as EventBus,
      logger: { info: vi.fn() } as unknown as Logger,
      minutes: 0,
    });
    expect(resolved).toBe(0);
    expect(autoResolveInactive).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
