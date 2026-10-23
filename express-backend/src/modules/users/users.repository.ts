import { and, count, desc, eq, ilike, ne, or, type SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users, type User, type UserRole } from "../../db/schema/index.js";

/** Columns that are safe to return from the API. */
const publicColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  username: users.username,
  displayUsername: users.displayUsername,
  role: users.role,
  banned: users.banned,
  banReason: users.banReason,
  banExpires: users.banExpires,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

export type PublicUser = Pick<User, keyof typeof publicColumns>;

export interface FindManyOptions {
  page: number;
  limit: number;
  role?: UserRole;
  search?: string;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export const usersRepository = {
  async findById(id: string, role?: UserRole): Promise<PublicUser | undefined> {
    const [user] = await db
      .select(publicColumns)
      .from(users)
      .where(and(eq(users.id, id), role ? eq(users.role, role) : undefined))
      .limit(1);
    return user;
  },

  async existsByUsernameOrEmail(username: string, email: string) {
    const [row] = await db
      .select({ username: users.username, email: users.email })
      .from(users)
      .where(or(eq(users.username, username), eq(users.email, email)))
      .limit(1);
    return row;
  },

  async findMany({ page, limit, role, search }: FindManyOptions) {
    const filters: (SQL | undefined)[] = [role ? eq(users.role, role) : undefined];
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      filters.push(or(ilike(users.name, pattern), ilike(users.username, pattern), ilike(users.email, pattern)));
    }
    const where = and(...filters);

    const [items, [totals]] = await Promise.all([
      db
        .select(publicColumns)
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: count() }).from(users).where(where),
    ]);

    return { items, total: totals?.total ?? 0 };
  },

  /** Active (not banned) admins other than `excludeId`. */
  async countOtherActiveAdmins(excludeId: string) {
    const [row] = await db
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.banned, false), ne(users.id, excludeId)));
    return row?.total ?? 0;
  },

  async update(id: string, data: Partial<Pick<User, "name" | "displayUsername" | "role" | "banned" | "banReason" | "banExpires">>): Promise<PublicUser | undefined> {
    const [updated] = await db
      .update(users)
      .set(data)
      .where(eq(users.id, id))
      .returning(publicColumns);
    return updated;
  },
};
