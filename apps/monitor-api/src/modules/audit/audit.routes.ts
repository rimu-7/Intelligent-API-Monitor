import { z } from 'zod';
import type { SecureRouter } from '../../http/secure-router';
import { ok } from '../../http/respond';
import type { AuditService } from './audit.service';

const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  action: z.string().trim().min(1).max(64).optional(),
  actor_id: z.uuid().optional(),
});

export const registerAuditRoutes = (router: SecureRouter, audit: AuditService): void => {
  router.route({
    method: 'get',
    path: '/audit-logs',
    access: { permission: 'audit:read' },
    schemas: { query: listQuery },
    handler: async (_req, res, { query }) => {
      const { items, total } = await audit.list({
        limit: query.limit,
        offset: query.offset,
        ...(query.action ? { action: query.action } : {}),
        ...(query.actor_id ? { actorId: query.actor_id } : {}),
      });
      ok(
        res,
        items.map((row) => ({
          id: row.id,
          actor_type: row.actorType,
          actor_id: row.actorId,
          action: row.action,
          target_type: row.targetType,
          target_id: row.targetId,
          metadata: row.metadata,
          ip: row.ip,
          request_id: row.requestId,
          created_at: row.createdAt.toISOString(),
        })),
        { meta: { total, limit: query.limit, offset: query.offset } },
      );
    },
  });
};
