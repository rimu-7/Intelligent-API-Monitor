import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../infrastructure/database/client';
import { auditLogs, type AuditLogRow } from '../../infrastructure/database/schema';

export interface AuditInsert {
  actorType: 'user' | 'service' | 'system' | 'anonymous';
  actorId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  requestId?: string | null;
}

export interface AuditQuery {
  limit: number;
  offset: number;
  action?: string;
  actorId?: string;
}

export class AuditRepository {
  constructor(private readonly db: DbExecutor) {}

  async insert(entry: AuditInsert, executor: DbExecutor = this.db): Promise<void> {
    await executor.insert(auditLogs).values({
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
      ip: entry.ip ?? null,
      requestId: entry.requestId ?? null,
    });
  }

  async list(query: AuditQuery): Promise<{ items: AuditLogRow[]; total: number }> {
    const filters: SQL[] = [];
    if (query.action) filters.push(eq(auditLogs.action, query.action));
    if (query.actorId) filters.push(eq(auditLogs.actorId, query.actorId));
    const where = filters.length > 0 ? and(...filters) : undefined;

    const [items, totals] = await Promise.all([
      this.db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db.select({ total: count() }).from(auditLogs).where(where),
    ]);
    return { items, total: totals[0]?.total ?? 0 };
  }
}
