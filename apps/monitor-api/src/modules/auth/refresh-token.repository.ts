import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../infrastructure/database/client';
import { refreshTokens, type RefreshTokenRow } from '../../infrastructure/database/schema';

export type RevokeReason = 'rotated' | 'logout' | 'reuse_detected' | 'password_changed' | 'access_changed';

export interface NewRefreshToken {
  /** Pre-generated so the rotated token can point at its replacement. */
  id?: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  createdIp: string | null;
  userAgent: string | null;
}

export class RefreshTokenRepository {
  constructor(private readonly db: DbExecutor) {}

  async insert(token: NewRefreshToken, executor: DbExecutor = this.db): Promise<RefreshTokenRow> {
    const [row] = await executor.insert(refreshTokens).values(token).returning();
    if (!row) throw new Error('refresh token insert returned no row');
    return row;
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRow | undefined> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row;
  }

  /**
   * Marks a token rotated only if it is still live. Returns false when another request
   * rotated it first (concurrent refresh from two tabs).
   */
  async markRotated(id: string, replacedById: string, executor: DbExecutor): Promise<boolean> {
    const rows = await executor
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: 'rotated', replacedById })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return rows.length === 1;
  }

  async revoke(id: string, reason: RevokeReason, executor: DbExecutor = this.db): Promise<void> {
    await executor
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)));
  }

  async revokeFamily(
    familyId: string,
    reason: RevokeReason,
    executor: DbExecutor = this.db,
  ): Promise<number> {
    const rows = await executor
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return rows.length;
  }

  async revokeAllForUser(
    userId: string,
    reason: RevokeReason,
    executor: DbExecutor = this.db,
  ): Promise<number> {
    const rows = await executor
      .update(refreshTokens)
      .set({ revokedAt: sql`now()`, revokedReason: reason })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return rows.length;
  }
}
