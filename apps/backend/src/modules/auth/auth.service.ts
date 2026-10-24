import type { Role } from '@apimon/shared';
import { randomUUID } from 'node:crypto';
import type { Database } from '../../infrastructure/database/client';
import type { Logger } from '../../infrastructure/logger';
import type { UserPrincipal } from '../../http/principal';
import { randomToken, sha256Hex } from '../../lib/crypto';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../lib/errors';
import type { AuditContext, AuditService } from '../audit/audit.service';
import type { PublicUser, UsersRepository } from '../users/users.repository';
import type { ChangePasswordInput, LoginInput } from './auth.schemas';
import type { LoginThrottle } from './login-throttle';
import type { PasswordService } from './password.service';
import type { RefreshTokenRepository } from './refresh-token.repository';
import type { TokenService } from './token.service';
import type { UserCache } from './user-cache';

export interface RequestMeta extends AuditContext {
  ip: string;
  userAgent?: string | undefined;
}

export interface IssuedSession {
  user: { id: string; email: string; role: Role };
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** A rotated token presented again within this window is a multi-tab race, not theft (§12.4). */
const REFRESH_RACE_GRACE_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AuthServiceDeps {
  db: Database;
  users: UsersRepository;
  refreshTokens: RefreshTokenRepository;
  passwords: PasswordService;
  tokens: TokenService;
  throttle: LoginThrottle;
  userCache: UserCache;
  audit: AuditService;
  logger: Logger;
  refreshTtlDays: number;
}

/**
 * Login, refresh rotation with reuse detection, logout and password change (§12.4–12.5).
 * Ported from the original module's auth service; Better Auth sessions replaced by
 * JWT access tokens + rotated refresh tokens (docs/DECISIONS.md ADR-010).
 */
export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async login(input: LoginInput, meta: RequestMeta): Promise<IssuedSession> {
    const { users, passwords, throttle, audit, logger } = this.deps;
    await throttle.beforeAttempt(meta.ip, input.email);

    const user = await users.findCredentialsByEmail(input.email);
    // Unknown email still pays for one argon2 verification (A3).
    const passwordOk = user
      ? await passwords.verify(user.passwordHash, input.password)
      : await passwords.verifyDummy(input.password);

    if (!user || !passwordOk || !user.isActive) {
      await throttle.recordFailure(input.email);
      const reason = !user ? 'unknown_email' : !passwordOk ? 'bad_password' : 'inactive';
      await audit.record({
        action: 'auth.login.failure',
        actor: user ? { kind: 'user', id: user.id } : null,
        metadata: { email: input.email, reason },
        context: meta,
      });
      logger.info({ event: 'auth.login.failure', reason }, 'login failed');
      // One message, one status for every failure cause.
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    await throttle.recordSuccess(input.email);
    await users.touchLastLogin(user.id);
    const session = await this.issueSession(user, randomUUID(), meta);
    await audit.record({ action: 'auth.login.success', actor: { kind: 'user', id: user.id }, context: meta });
    logger.info({ event: 'auth.login.success', userId: user.id }, 'login succeeded');
    return session;
  }

  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    const { db, refreshTokens, users, audit, logger } = this.deps;
    if (!rawToken) throw new UnauthorizedError('Refresh token missing');

    const presented = await refreshTokens.findByHash(sha256Hex(rawToken));
    if (!presented) throw new UnauthorizedError('Invalid refresh token');

    if (presented.revokedAt) {
      const rotatedRecently =
        presented.revokedReason === 'rotated' &&
        Date.now() - presented.revokedAt.getTime() < REFRESH_RACE_GRACE_MS;
      if (rotatedRecently) {
        // Another tab won the race; the shared cookie already holds the new token.
        throw new UnauthorizedError('Refresh already in progress, retry', 'REFRESH_RACE');
      }
      const revoked = await refreshTokens.revokeFamily(presented.familyId, 'reuse_detected');
      await audit.record({
        action: 'auth.refresh_reuse_detected',
        actor: { kind: 'user', id: presented.userId },
        metadata: {
          family_id: presented.familyId,
          revoked_tokens: revoked,
          previous_reason: presented.revokedReason,
        },
        context: meta,
      });
      logger.warn(
        { event: 'auth.refresh_reuse_detected', userId: presented.userId },
        'refresh token reuse detected',
      );
      throw new UnauthorizedError('Refresh token is no longer valid');
    }

    if (presented.expiresAt.getTime() <= Date.now()) throw new UnauthorizedError('Refresh token expired');

    const user = await users.findCredentialsById(presented.userId);
    if (!user || !user.isActive) {
      await refreshTokens.revokeFamily(presented.familyId, 'access_changed');
      throw new UnauthorizedError('Refresh token is no longer valid');
    }

    return db.transaction(async (tx) => {
      const session = await this.issueSession(user, presented.familyId, meta, tx, async (newId) => {
        const rotated = await refreshTokens.markRotated(presented.id, newId, tx);
        if (!rotated) throw new UnauthorizedError('Refresh already in progress, retry', 'REFRESH_RACE');
      });
      return session;
    });
  }

  /** Revokes the presented refresh token server-side (A8). Always succeeds from the client's view. */
  async logout(
    rawToken: string | undefined,
    principal: UserPrincipal | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    const { refreshTokens, audit } = this.deps;
    let userId = principal?.id;
    if (rawToken) {
      const presented = await refreshTokens.findByHash(sha256Hex(rawToken));
      if (presented) {
        await refreshTokens.revoke(presented.id, 'logout');
        userId ??= presented.userId;
      }
    }
    if (userId)
      await audit.record({ action: 'auth.logout', actor: { kind: 'user', id: userId }, context: meta });
  }

  async me(principal: UserPrincipal): Promise<PublicUser> {
    const user = await this.deps.users.findById(principal.id);
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  /** Re-hashes, bumps token_version, revokes every refresh token, then starts a fresh session (A9). */
  async changePassword(
    principal: UserPrincipal,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const { db, users, passwords, refreshTokens, userCache, audit } = this.deps;
    const user = await users.findCredentialsById(principal.id);
    if (!user || !user.isActive) throw new UnauthorizedError();

    if (!(await passwords.verify(user.passwordHash, input.current_password))) {
      throw new ValidationError('Current password is incorrect', [
        { path: 'current_password', message: 'Current password is incorrect' },
      ]);
    }
    const newHash = await passwords.hash(input.new_password);

    const session = await db.transaction(async (tx) => {
      const updated = await users.updatePassword(user.id, newHash, tx);
      await refreshTokens.revokeAllForUser(user.id, 'password_changed', tx);
      await audit.record({ action: 'auth.password_changed', actor: principal, context: meta }, tx);
      return this.issueSession({ ...user, tokenVersion: updated.tokenVersion }, randomUUID(), meta, tx);
    });
    await userCache.invalidate(user.id);
    return session;
  }

  private async issueSession(
    user: { id: string; email: string; role: Role; tokenVersion: number },
    familyId: string,
    meta: RequestMeta,
    executor?: Parameters<RefreshTokenRepository['insert']>[1],
    beforeInsert?: (newTokenId: string) => Promise<void>,
  ): Promise<IssuedSession> {
    const { tokens, refreshTokens, refreshTtlDays } = this.deps;
    const refreshToken = randomToken(32);
    const refreshExpiresAt = new Date(Date.now() + refreshTtlDays * DAY_MS);
    const newId = randomUUID();

    await beforeInsert?.(newId);
    await refreshTokens.insert(
      {
        userId: user.id,
        familyId,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: refreshExpiresAt,
        createdIp: isIp(meta.ip) ? meta.ip : null,
        userAgent: meta.userAgent?.slice(0, 256) ?? null,
        id: newId,
      },
      executor,
    );

    return {
      user: { id: user.id, email: user.email, role: user.role },
      accessToken: await tokens.sign(user),
      expiresIn: tokens.ttlSeconds,
      refreshToken,
      refreshExpiresAt,
    };
  }
}

const isIp = (value: string): boolean => /^[0-9a-fA-F:.]+$/.test(value) && value.length <= 45;
