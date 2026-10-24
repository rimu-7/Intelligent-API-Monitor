import type { Permission } from '@apimon/shared';
import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../lib/errors';
import type { Principal } from '../principal';

/**
 * How a route may be reached. Required on every route (§11.1, A10):
 * - `{ public: true }`           — anyone (health, docs, login)
 * - `{ authenticated: true }`    — any logged-in user, whatever the role (e.g. /auth/me)
 * - `{ permission, userOnly? }`  — principal must hold the permission; `userOnly` also requires a logged-in user
 * - `{ streamTicket: true }`     — SSE stream: the handler consumes a single-use ticket (or demo anonymous)
 */
export type Access =
  | { public: true }
  | { authenticated: true }
  | { permission: Permission; userOnly?: boolean }
  | { streamTicket: true };

const deny = (principal: Principal): never => {
  // Anonymous → 401 (log in); a known principal lacking the permission → 403.
  if (principal.kind === 'anonymous') throw new UnauthorizedError();
  throw new ForbiddenError();
};

/** The only authorization check in the codebase: membership in ROLE_PERMISSIONS (no role comparisons). */
export const requirePermission =
  (permission: Permission, options: { userOnly?: boolean } = {}): RequestHandler =>
  (req, _res, next) => {
    const { principal } = req;
    if (!principal.permissions.has(permission)) deny(principal);
    if (options.userOnly && principal.kind !== 'user') deny(principal);
    next();
  };

export const requireUser: RequestHandler = (req, _res, next) => {
  if (req.principal.kind !== 'user') throw new UnauthorizedError();
  next();
};

const passThrough: RequestHandler = (_req, _res, next) => next();

export const authorizeAccess = (access: Access): RequestHandler => {
  if ('permission' in access)
    return requirePermission(access.permission, { userOnly: access.userOnly ?? false });
  if ('authenticated' in access) return requireUser;
  return passThrough;
};

export const describeAccess = (access: Access): string => {
  if ('permission' in access) return access.userOnly ? `${access.permission} (user)` : access.permission;
  if ('authenticated' in access) return 'authenticated';
  if ('streamTicket' in access) return 'stream-ticket';
  return 'public';
};
