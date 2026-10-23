import { rolesWithPermission } from '@apimon/shared';
import type { Database } from '../../infrastructure/database/client';
import { runInTransaction } from '../../infrastructure/database/transaction';
import type { Logger } from '../../infrastructure/logger';
import type { UserPrincipal } from '../../http/principal';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';
import type { AuditContext, AuditService } from '../audit/audit.service';
import type { PasswordService } from '../auth/password.service';
import type { RefreshTokenRepository } from '../auth/refresh-token.repository';
import type { UserCache } from '../auth/user-cache';
import type { PublicUser, UsersRepository } from './users.repository';
import type { CreateUserInput, ListUsersInput, UpdateUserInput } from './users.schemas';

export interface UsersServiceDeps {
  db: Database;
  users: UsersRepository;
  refreshTokens: RefreshTokenRepository;
  passwords: PasswordService;
  userCache: UserCache;
  audit: AuditService;
  logger: Logger;
}

/**
 * Admin-only user management (§12.6). Ported from the original users service: no public
 * registration, no acting on your own account, and the last active admin is protected.
 * "Admin" here means any role that holds `users:manage` — no role names are compared.
 */
export class UsersService {
  constructor(private readonly deps: UsersServiceDeps) {}

  list(query: ListUsersInput) {
    return this.deps.users.list({
      limit: query.limit,
      offset: query.offset,
      ...(query.role ? { role: query.role } : {}),
      ...(query.is_active === undefined ? {} : { isActive: query.is_active }),
    });
  }

  async create(input: CreateUserInput, actor: UserPrincipal, context: AuditContext): Promise<PublicUser> {
    const { db, users, passwords, audit } = this.deps;
    if (await users.existsByEmail(input.email))
      throw new ConflictError('A user with this email already exists');

    const passwordHash = await passwords.hash(input.password);
    return db.transaction(async (tx) => {
      const user = await users.insert({ email: input.email, passwordHash, role: input.role }, tx);
      await audit.record(
        {
          action: 'user.created',
          actor,
          target: { type: 'user', id: user.id },
          metadata: { role: user.role },
          context,
        },
        tx,
      );
      return user;
    });
  }

  async update(
    id: string,
    input: UpdateUserInput,
    actor: UserPrincipal,
    context: AuditContext,
  ): Promise<PublicUser> {
    const { db, users, refreshTokens, userCache, audit, logger } = this.deps;
    const actingOnSelf = actor.id === id;
    if (actingOnSelf && input.role) throw new ForbiddenError('You cannot change your own role');
    if (actingOnSelf && input.is_active === false)
      throw new ForbiddenError('You cannot deactivate your own account');

    const managerRoles = rolesWithPermission('users:manage');

    const result = await runInTransaction(db, logger, async (tx) => {
      // Lock admins first (id order), then the target — one consistent lock order.
      const activeManagerIds = await users.lockActiveUserIdsWithRoles(managerRoles, tx);
      const target = await users.lockById(id, tx);
      if (!target) throw new NotFoundError('User not found');

      const currentRole = target.role;
      const nextRole = input.role ?? currentRole;
      const roleChanged = nextRole !== currentRole;
      const deactivating = input.is_active === false && target.isActive;
      const reactivating = input.is_active === true && !target.isActive;
      if (!roleChanged && !deactivating && !reactivating) return { user: target, changed: false };

      const targetManagesUsers = activeManagerIds.includes(target.id);
      const stillManagesUsers = managerRoles.includes(nextRole) && !deactivating;
      if (targetManagesUsers && !stillManagesUsers && activeManagerIds.length <= 1) {
        throw new ConflictError('The last active admin cannot be demoted or deactivated', 'LAST_ADMIN');
      }

      // Role change or deactivation must end every existing session immediately (A9).
      const invalidateSessions = roleChanged || deactivating;
      const user = await users.updateAccess(
        id,
        {
          ...(roleChanged ? { role: nextRole } : {}),
          ...(deactivating ? { isActive: false } : reactivating ? { isActive: true } : {}),
          bumpTokenVersion: invalidateSessions,
        },
        tx,
      );
      if (invalidateSessions) await refreshTokens.revokeAllForUser(id, 'access_changed', tx);

      const targetRef = { type: 'user', id };
      if (roleChanged) {
        await audit.record(
          {
            action: 'user.role_changed',
            actor,
            target: targetRef,
            metadata: { from: currentRole, to: nextRole },
            context,
          },
          tx,
        );
      }
      if (deactivating)
        await audit.record({ action: 'user.deactivated', actor, target: targetRef, context }, tx);
      if (reactivating)
        await audit.record({ action: 'user.reactivated', actor, target: targetRef, context }, tx);
      return { user, changed: true };
    });

    if (result.changed) await userCache.invalidate(id);
    return result.user;
  }
}
