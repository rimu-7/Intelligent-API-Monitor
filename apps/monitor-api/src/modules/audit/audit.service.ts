import type { DbExecutor } from '../../infrastructure/database/client';
import type { Logger } from '../../infrastructure/logger';
import type { Principal } from '../../http/principal';
import type { AuditRepository, AuditQuery } from './audit.repository';

export type AuditAction =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  | 'auth.refresh_reuse_detected'
  | 'auth.password_changed'
  | 'user.created'
  | 'user.role_changed'
  | 'user.deactivated'
  | 'user.reactivated'
  | 'alert.resolved'
  | 'alert.regenerated'
  | 'api.thresholds_changed'
  | 'settings.notifications_changed'
  | 'settings.test_email_sent';

export interface AuditContext {
  ip?: string | undefined;
  requestId?: string | undefined;
}

export interface AuditEntry {
  action: AuditAction;
  /** Omit for system actions (scheduled jobs, seed). */
  actor?: Principal | { kind: 'user'; id: string } | null;
  target?: { type: string; id: string };
  metadata?: Record<string, unknown>;
  context?: AuditContext;
}

const actorOf = (actor: AuditEntry['actor']) => {
  if (!actor) return { actorType: 'system' as const, actorId: null };
  if (actor.kind === 'user') return { actorType: 'user' as const, actorId: actor.id };
  return { actorType: actor.kind, actorId: null };
};

/** Security event trail (A19, §12.6). */
export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Records an audit event. Pass the transaction to make the event atomic with the change.
   * Without a transaction a write failure is logged and swallowed so it never blocks the user action.
   */
  async record(entry: AuditEntry, executor?: DbExecutor): Promise<void> {
    const row = {
      ...actorOf(entry.actor),
      action: entry.action,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      metadata: entry.metadata ?? {},
      ip: entry.context?.ip ?? null,
      requestId: entry.context?.requestId ?? null,
    };
    if (executor) {
      await this.repository.insert(row, executor);
      return;
    }
    try {
      await this.repository.insert(row);
    } catch (err) {
      this.logger.error({ err, action: entry.action }, 'audit log write failed');
    }
  }

  list(query: AuditQuery) {
    return this.repository.list(query);
  }
}
