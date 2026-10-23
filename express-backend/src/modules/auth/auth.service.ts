import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db/client.js";
import { sessions } from "../../db/schema/index.js";
import { auth, type AuthSession, type AuthUser } from "../../lib/auth.js";
import { isRole, roles } from "../../lib/permissions.js";
import {
  blacklistToken,
  checkAccountLockout,
  clearAccountLockout,
  purgeUserSessions,
  recordFailedLogin,
  redis,
} from "../../lib/redis.js";
import { ApiError } from "../../utils/api-error.js";
import { usersRepository } from "../users/users.repository.js";
import type { ChangePasswordInput, LoginInput, UpdateProfileInput } from "./auth.schema.js";

export const authService = {
  /**
   * High-security login protected by Redis Account Lockout Shield
   * and Redis-backed session caching.
   */
  async login(input: LoginInput, requestHeaders: Headers, clientIp: string) {
    // 1. Check Redis account lockout shield
    const lockout = await checkAccountLockout(input.username, clientIp);
    if (lockout.locked) {
      throw new ApiError(
        423,
        "ACCOUNT_LOCKED",
        `${lockout.reason}. Please try again in ${lockout.remainingSeconds} seconds.`,
        { retryAfterSeconds: lockout.remainingSeconds },
      );
    }

    try {
      const { headers, response } = await auth.api.signInUsername({
        body: { username: input.username, password: input.password },
        headers: requestHeaders,
        returnHeaders: true,
      });

      if (!response) {
        throw new Error("Invalid username or password");
      }

      const user = await usersRepository.findById(response.user.id);
      if (!user) {
        throw new Error("User record not found");
      }

      if (user.banned) {
        if (response.token) await blacklistToken(response.token);
        throw ApiError.forbidden("Account is suspended: " + (user.banReason || "Contact administrator"));
      }

      // Successful login resets brute-force attempt counter
      await clearAccountLockout(input.username, clientIp);

      return { headers, token: response.token, user };
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 403) throw error;

      // Increment failed attempts and trigger lockout if limit reached
      const status = await recordFailedLogin(input.username, clientIp);
      if (status.locked) {
        throw new ApiError(
          423,
          "ACCOUNT_LOCKED",
          `Too many failed login attempts. Account temporarily locked for ${status.remainingSeconds} seconds.`,
          { retryAfterSeconds: status.remainingSeconds },
        );
      }

      const attemptsRemaining = Math.max(0, 5 - status.attempts);
      throw ApiError.unauthorized(
        `Invalid username or password. ${attemptsRemaining} attempt(s) remaining before temporary lockout.`,
      );
    }
  },

  /**
   * Logs out user, invalidates session in Better Auth, and blacklists token in Redis.
   */
  async logout(requestHeaders: Headers, sessionToken?: string) {
    const { headers } = await auth.api.signOut({ headers: requestHeaders, returnHeaders: true });
    if (sessionToken) {
      await blacklistToken(sessionToken);
    }
    return headers;
  },

  /**
   * Returns current user identity, RBAC permission statements, and active session details.
   */
  async me({ user, session }: AuthSession) {
    const profile = await usersRepository.findById(user.id);
    if (!profile) throw ApiError.unauthorized();

    return {
      user: profile,
      permissions: isRole(profile.role) ? roles[profile.role].statements : {},
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      },
    };
  },

  /**
   * Lists all active sessions for the authenticated user, identifying the current session.
   * Reads from Redis secondaryStorage (instant) and falls back to database.
   */
  async listSessions(actor: AuthUser, currentSessionId: string, requestHeaders?: Headers) {
    // 1. Try Better Auth native listSessions
    if (requestHeaders) {
      try {
        const native = await auth.api.listSessions({ headers: requestHeaders });
        if (Array.isArray(native) && native.length > 0) {
          return native.map((s) => ({
            id: s.id,
            ipAddress: s.ipAddress || "Unknown",
            userAgent: s.userAgent || "Unknown",
            expiresAt: s.expiresAt,
            createdAt: s.createdAt,
            isCurrent: s.id === currentSessionId,
          }));
        }
      } catch {
        // Continue to Redis check
      }
    }

    // 2. Query Redis secondary storage directly
    try {
      const activeRaw = await redis.get(`ams:auth:active-sessions-${actor.id}`);
      if (activeRaw) {
        const activeTokens: { token: string; expiresAt: number }[] = JSON.parse(activeRaw);
        const sessionPromises = activeTokens.map(async ({ token }) => {
          const raw = await redis.get(`ams:auth:${token}`);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          const s = parsed.session;
          if (!s) return null;
          return {
            id: s.id,
            ipAddress: s.ipAddress || "Unknown",
            userAgent: s.userAgent || "Unknown",
            expiresAt: s.expiresAt,
            createdAt: s.createdAt,
            isCurrent: s.id === currentSessionId || s.token === token,
          };
        });
        const redisSessions = (await Promise.all(sessionPromises)).filter(
          (item): item is NonNullable<typeof item> => item !== null,
        );
        if (redisSessions.length > 0) return redisSessions;
      }
    } catch {
      // Continue to DB fallback
    }

    // 3. Fallback to PostgreSQL sessions table
    const dbSessions = await db
      .select({
        id: sessions.id,
        ipAddress: sessions.ipAddress,
        userAgent: sessions.userAgent,
        expiresAt: sessions.expiresAt,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, actor.id));

    return dbSessions.map((s) => ({
      ...s,
      isCurrent: s.id === currentSessionId,
    }));
  },

  /**
   * Revokes a specific session by ID and places its token into Redis blacklist.
   */
  async revokeSession(sessionId: string, actor: AuthUser, requestHeaders?: Headers) {
    let targetToken = sessionId;

    // Purge from Redis secondary storage and blacklist token
    try {
      const activeRaw = await redis.get(`ams:auth:active-sessions-${actor.id}`);
      if (activeRaw) {
        const activeTokens: { token: string; expiresAt: number }[] = JSON.parse(activeRaw);
        const remaining: { token: string; expiresAt: number }[] = [];
        for (const item of activeTokens) {
          const raw = await redis.get(`ams:auth:${item.token}`);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.session?.id === sessionId || item.token === sessionId) {
              targetToken = item.token;
              await redis.del(`ams:auth:${item.token}`);
              await blacklistToken(item.token);
              continue;
            }
          }
          remaining.push(item);
        }
        await redis.set(`ams:auth:active-sessions-${actor.id}`, JSON.stringify(remaining));
      }
    } catch {
      // ignore
    }

    if (requestHeaders && targetToken) {
      try {
        await auth.api.revokeSession({ headers: requestHeaders, body: { token: targetToken } });
      } catch {
        // ignore
      }
    }

    await db.delete(sessions).where(eq(sessions.id, sessionId));

    return { message: "Session successfully revoked" };
  },

  /**
   * Revokes all other sessions except the currently active one.
   */
  async revokeOtherSessions(actor: AuthUser, currentSessionId: string, requestHeaders?: Headers) {
    if (requestHeaders) {
      try {
        await auth.api.revokeOtherSessions({ headers: requestHeaders });
      } catch {
        // ignore
      }
    }

    let count = 0;
    try {
      const activeRaw = await redis.get(`ams:auth:active-sessions-${actor.id}`);
      if (activeRaw) {
        const activeTokens: { token: string; expiresAt: number }[] = JSON.parse(activeRaw);
        const remaining: { token: string; expiresAt: number }[] = [];
        for (const item of activeTokens) {
          const raw = await redis.get(`ams:auth:${item.token}`);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.session?.id !== currentSessionId) {
              await redis.del(`ams:auth:${item.token}`);
              await blacklistToken(item.token);
              count++;
              continue;
            }
          }
          remaining.push(item);
        }
        await redis.set(`ams:auth:active-sessions-${actor.id}`, JSON.stringify(remaining));
      }
    } catch {
      // ignore
    }

    await db.delete(sessions).where(and(eq(sessions.userId, actor.id), ne(sessions.id, currentSessionId)));

    return { message: `Revoked ${count} other active session(s)` };
  },

  /**
   * Changes the authenticated user's password securely.
   */
  async changePassword(actor: AuthUser, input: ChangePasswordInput, requestHeaders: Headers, currentSessionId: string) {
    await auth.api.changePassword({
      headers: requestHeaders,
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: input.revokeOtherSessions,
      },
    });

    if (input.revokeOtherSessions) {
      await this.revokeOtherSessions(actor, currentSessionId, requestHeaders);
    }

    return { message: "Password updated successfully" };
  },

  /**
   * Updates profile details (display name or name).
   */
  async updateProfile(userId: string, input: UpdateProfileInput) {
    const updated = await usersRepository.update(userId, {
      name: input.name,
      displayUsername: input.displayUsername,
    });
    if (!updated) throw ApiError.notFound("User not found");
    return updated;
  },
};
