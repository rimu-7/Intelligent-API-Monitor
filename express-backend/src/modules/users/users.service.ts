import { auth, type AuthUser } from "../../lib/auth.js";
import type { Role } from "../../lib/permissions.js";
import { purgeUserSessions } from "../../lib/redis.js";
import { ApiError } from "../../utils/api-error.js";
import type { PaginationMeta } from "../../utils/http-response.js";
import { usersRepository, type PublicUser } from "./users.repository.js";
import type { BanUserInput, CreateUserInput, ListUsersQuery } from "./users.schema.js";

const DAY_IN_SECONDS = 60 * 60 * 24;

/** Admins see everyone; managers only see managers. */
const visibleRoleFor = (actor: AuthUser): Role | undefined => (actor.role === "admin" ? undefined : "manager");

const getOrThrow = async (id: string, actor: AuthUser): Promise<PublicUser> => {
  const user = await usersRepository.findById(id, visibleRoleFor(actor));
  if (!user) throw ApiError.notFound("User not found");
  return user;
};

const assertNotSelf = (actor: AuthUser, targetId: string, action: string) => {
  if (actor.id === targetId) throw ApiError.forbidden(`You cannot ${action} your own account`);
};

/** Stops the system from ending up with no admin who can sign in. */
const assertNotLastAdmin = async (target: PublicUser) => {
  if (target.role !== "admin" || target.banned) return;
  if ((await usersRepository.countOtherActiveAdmins(target.id)) === 0) {
    throw ApiError.conflict("This is the last active admin and cannot be removed, banned or demoted");
  }
};

export const usersService = {
  async create(input: CreateUserInput, headers: Headers): Promise<PublicUser> {
    const username = input.username.toLowerCase();

    const existing = await usersRepository.existsByUsernameOrEmail(username, input.email);
    if (existing) {
      throw ApiError.conflict(existing.username === username ? "Username is already taken" : "Email is already in use");
    }

    const { user } = await auth.api.createUser({
      headers,
      body: {
        name: input.name,
        email: input.email,
        password: input.password,
        role: input.role,
        data: { username, displayUsername: input.username },
      },
    });

    const created = await usersRepository.findById(user.id);
    if (!created) throw new Error(`User ${user.id} was created but could not be loaded`);
    return created;
  },

  async list(query: ListUsersQuery, actor: AuthUser): Promise<{ items: PublicUser[]; meta: PaginationMeta }> {
    const scopedRole = visibleRoleFor(actor);
    // A manager asking for admins gets nothing back, never admin records.
    if (scopedRole && query.role && query.role !== scopedRole) {
      return { items: [], meta: { page: query.page, limit: query.limit, total: 0, totalPages: 0 } };
    }

    const { items, total } = await usersRepository.findMany({ ...query, role: scopedRole ?? query.role });
    return {
      items,
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  },

  getById: getOrThrow,

  async updateRole(id: string, role: Role, actor: AuthUser, headers: Headers): Promise<PublicUser> {
    assertNotSelf(actor, id, "change the role of");
    const target = await getOrThrow(id, actor);
    if (target.role === role) return target;
    if (role !== "admin") await assertNotLastAdmin(target);

    await auth.api.setRole({ headers, body: { userId: id, role } });
    await purgeUserSessions(id);
    return getOrThrow(id, actor);
  },

  async ban(id: string, input: BanUserInput, actor: AuthUser, headers: Headers): Promise<PublicUser> {
    assertNotSelf(actor, id, "ban");
    const target = await getOrThrow(id, actor);
    await assertNotLastAdmin(target);

    // Better Auth revokes sessions in DB; Redis purges cached sessions and invalidates tokens immediately
    await auth.api.banUser({
      headers,
      body: {
        userId: id,
        banReason: input.reason,
        banExpiresIn: input.expiresInDays ? input.expiresInDays * DAY_IN_SECONDS : undefined,
      },
    });
    await purgeUserSessions(id);
    return getOrThrow(id, actor);
  },

  async unban(id: string, actor: AuthUser, headers: Headers): Promise<PublicUser> {
    const target = await getOrThrow(id, actor);
    if (!target.banned) return target;

    await auth.api.unbanUser({ headers, body: { userId: id } });
    await purgeUserSessions(id);
    return getOrThrow(id, actor);
  },

  async remove(id: string, actor: AuthUser, headers: Headers): Promise<void> {
    assertNotSelf(actor, id, "delete");
    const target = await getOrThrow(id, actor);
    await assertNotLastAdmin(target);

    await auth.api.removeUser({ headers, body: { userId: id } });
    await purgeUserSessions(id);
  },
};
