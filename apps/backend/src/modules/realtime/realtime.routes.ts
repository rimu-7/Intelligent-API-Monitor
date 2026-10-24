import { permissionsForRole } from '@apimon/shared';
import { z } from 'zod';
import { clientIp } from '../../http/middleware/rate-limit';
import { requireUserPrincipal } from '../../http/principal';
import { ok } from '../../http/respond';
import type { SecureRouter } from '../../http/secure-router';
import { ForbiddenError, UnauthorizedError } from '../../lib/errors';
import type { SseHub } from './sse-hub';
import type { StreamTickets } from './stream-tickets';

const streamQuery = z.object({ ticket: z.string().min(1).max(200).optional() });

/** Registered before /alerts/:id so the static segments win. */
export const registerRealtimeRoutes = (
  api: SecureRouter,
  deps: { hub: SseHub; tickets: StreamTickets },
): void => {
  api.route({
    method: 'post',
    path: '/alerts/stream-ticket',
    access: { permission: 'alerts:read', userOnly: true },
    handler: async (req, res) => {
      const user = requireUserPrincipal(req.principal);
      res.setHeader('Cache-Control', 'no-store');
      ok(res, await deps.tickets.issue({ userId: user.id, role: user.role }));
    },
  });

  // Ticket (single use), or anonymous in demo mode; a bearer token also works for non-browser clients.
  api.route({
    method: 'get',
    path: '/alerts/stream',
    access: { streamTicket: true },
    schemas: { query: streamQuery },
    handler: async (req, res, { query }) => {
      let key: string;
      if (query.ticket !== undefined) {
        const owner = await deps.tickets.consume(query.ticket);
        if (!owner) throw new UnauthorizedError('Invalid or expired stream ticket');
        if (!permissionsForRole(owner.role).includes('alerts:read')) throw new ForbiddenError();
        key = `user:${owner.userId}`;
      } else if (req.principal.permissions.has('alerts:read')) {
        key =
          req.principal.kind === 'anonymous'
            ? `anon:${clientIp(req)}`
            : `${req.principal.kind}:${req.principal.id}`;
      } else if (req.principal.kind === 'anonymous') {
        throw new UnauthorizedError('A stream ticket is required');
      } else {
        throw new ForbiddenError();
      }
      deps.hub.connect(res, key);
    },
  });
};
