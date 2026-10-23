import { UnauthorizedError } from '../lib/errors';
import {
  DEMO_PERMISSIONS,
  INGEST_KEY_PERMISSIONS,
  permissionsForRole,
  type Permission,
  type Role,
} from '@apimon/shared';

/** Who is calling (§12.3). Resolved once per request by `authenticate`. */
export type Principal =
  | { kind: 'user'; id: string; email: string; role: Role; permissions: ReadonlySet<Permission> }
  | { kind: 'service'; id: 'ingest-key'; permissions: ReadonlySet<Permission> }
  | { kind: 'anonymous'; id: 'anonymous'; permissions: ReadonlySet<Permission> };

export type UserPrincipal = Extract<Principal, { kind: 'user' }>;

export const userPrincipal = (user: { id: string; email: string; role: Role }): UserPrincipal => ({
  kind: 'user',
  id: user.id,
  email: user.email,
  role: user.role,
  permissions: new Set(permissionsForRole(user.role)),
});

export const ingestKeyPrincipal = (): Principal => ({
  kind: 'service',
  id: 'ingest-key',
  permissions: new Set(INGEST_KEY_PERMISSIONS),
});

export const anonymousPrincipal = (demoMode: boolean): Principal => ({
  kind: 'anonymous',
  id: 'anonymous',
  permissions: new Set(demoMode ? DEMO_PERMISSIONS : []),
});

/** Stored in monitor_runs.principal and audit logs. */
export const principalLabel = (principal: Principal): string => principal.id;

/** The logged-in user behind this request; 401 if the route was reached without one. */
export const requireUserPrincipal = (principal: Principal): UserPrincipal => {
  if (principal.kind !== 'user') throw new UnauthorizedError();
  return principal;
};
