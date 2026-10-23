import type { Role } from '@apimon/shared';
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../infrastructure/database/client';
import { users, type UserRow } from '../../infrastructure/database/schema';

/** Columns that are safe to return from the API (never the password hash). */
const publicColumns = {
  id: users.id,
  email: users.email,
  role: users.role,
  isActive: users.isActive,
  tokenVersion: users.tokenVersion,
  lastLoginAt: users.lastLoginAt,
  passwordChangedAt: users.passwordChangedAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

export type PublicUser = Pick<UserRow, keyof typeof publicColumns>;

export interface ListUsersOptions {
  limit: number;
  offset: number;
  role?: Role;
  isActive?: boolean;
}

export class UsersRepository {
  constructor(private readonly db: DbExecutor) {}

  async findById(id: string, executor: DbExecutor = this.db): Promise<PublicUser | undefined> {
    const [row] = await executor.select(publicColumns).from(users).where(eq(users.id, id)).limit(1);
    return row;
  }

  /** Includes the password hash — auth only. */
  async findCredentialsByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row;
  }

  async findCredentialsById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  }

  async existsByEmail(email: string): Promise<boolean> {
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    return row !== undefined;
  }

  async list({
    limit,
    offset,
    role,
    isActive,
  }: ListUsersOptions): Promise<{ items: PublicUser[]; total: number }> {
    const filters: SQL[] = [];
    if (role) filters.push(eq(users.role, role));
    if (isActive !== undefined) filters.push(eq(users.isActive, isActive));
    const where = filters.length > 0 ? and(...filters) : undefined;

    const [items, totals] = await Promise.all([
      this.db
        .select(publicColumns)
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(users).where(where),
    ]);
    return { items, total: totals[0]?.total ?? 0 };
  }

  async insert(
    data: { email: string; passwordHash: string; role: Role },
    executor: DbExecutor = this.db,
  ): Promise<PublicUser> {
    const [row] = await executor.insert(users).values(data).returning(publicColumns);
    if (!row) throw new Error('user insert returned no row');
    return row;
  }

  /**
   * Locks every active user holding one of `roles` FOR UPDATE, in id order (consistent lock
   * order → no deadlocks), so two concurrent demotions cannot both pass the last-admin check (A13).
   */
  async lockActiveUserIdsWithRoles(roles: readonly Role[], executor: DbExecutor): Promise<string[]> {
    if (roles.length === 0) return [];
    const rows = await executor
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, [...roles]), eq(users.isActive, true)))
      .orderBy(users.id)
      .for('update');
    return rows.map((row) => row.id);
  }

  async lockById(id: string, executor: DbExecutor): Promise<PublicUser | undefined> {
    const [row] = await executor
      .select(publicColumns)
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
      .for('update');
    return row;
  }

  /** Applies a role/active change; bumps token_version when sessions must be invalidated (A9). */
  async updateAccess(
    id: string,
    change: { role?: Role; isActive?: boolean; bumpTokenVersion: boolean },
    executor: DbExecutor,
  ): Promise<PublicUser> {
    const [row] = await executor
      .update(users)
      .set({
        ...(change.role ? { role: change.role } : {}),
        ...(change.isActive === undefined ? {} : { isActive: change.isActive }),
        ...(change.bumpTokenVersion ? { tokenVersion: sql`${users.tokenVersion} + 1` } : {}),
      })
      .where(eq(users.id, id))
      .returning(publicColumns);
    if (!row) throw new Error(`user ${id} disappeared during update`);
    return row;
  }

  async updatePassword(
    id: string,
    passwordHash: string,
    executor: DbExecutor = this.db,
  ): Promise<PublicUser> {
    const [row] = await executor
      .update(users)
      .set({ passwordHash, passwordChangedAt: new Date(), tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, id))
      .returning(publicColumns);
    if (!row) throw new Error(`user ${id} disappeared during password update`);
    return row;
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
  }
}
