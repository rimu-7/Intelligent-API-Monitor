import { isRole, type Role } from '@apimon/shared';
import type { Redis } from 'ioredis';
import type { Logger } from '../../infrastructure/logger';
import type { UsersRepository } from '../users/users.repository';

export interface UserSummary {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  tokenVersion: number;
}

const TTL_SECONDS = 60;
const keyOf = (id: string) => `user:${id}`;

const parse = (raw: string): UserSummary | undefined => {
  try {
    const value = JSON.parse(raw) as Partial<UserSummary>;
    if (
      typeof value.id === 'string' &&
      typeof value.email === 'string' &&
      isRole(value.role) &&
      typeof value.isActive === 'boolean' &&
      typeof value.tokenVersion === 'number'
    ) {
      return value as UserSummary;
    }
  } catch {
    // fall through to a DB read
  }
  return undefined;
};

/** `user:<id>` summary cache used on every authenticated request (§12.3). DB is the fallback. */
export class UserCache {
  constructor(
    private readonly redis: Redis,
    private readonly users: UsersRepository,
    private readonly logger: Logger,
  ) {}

  async get(id: string): Promise<UserSummary | undefined> {
    try {
      const cached = await this.redis.get(keyOf(id));
      const parsed = cached ? parse(cached) : undefined;
      if (parsed) return parsed;
    } catch (err) {
      this.logger.warn({ err }, 'user cache read failed, using database');
    }

    const user = await this.users.findById(id);
    if (!user) return undefined;
    const summary: UserSummary = {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      tokenVersion: user.tokenVersion,
    };
    try {
      await this.redis.set(keyOf(id), JSON.stringify(summary), 'EX', TTL_SECONDS);
    } catch (err) {
      this.logger.warn({ err }, 'user cache write failed');
    }
    return summary;
  }

  /** If Redis is down the entry still expires within 60 s; token_version in the DB is the source of truth. */
  async invalidate(id: string): Promise<void> {
    try {
      await this.redis.del(keyOf(id));
    } catch (err) {
      this.logger.warn({ err, userId: id }, 'user cache invalidation failed');
    }
  }
}
