import type { Redis } from 'ioredis';
import type { Env } from './config/env';
import { createDatabase, type Database, type DatabaseHandle } from './infrastructure/database/client';
import { createLogger, type Logger } from './infrastructure/logger';
import { closeRedis, createRedis } from './infrastructure/redis/connections';
import { AuditRepository } from './modules/audit/audit.repository';
import { AuditService } from './modules/audit/audit.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { LoginThrottle } from './modules/auth/login-throttle';
import { PasswordService } from './modules/auth/password.service';
import { RefreshTokenRepository } from './modules/auth/refresh-token.repository';
import { TokenService } from './modules/auth/token.service';
import { UserCache } from './modules/auth/user-cache';
import { HealthService } from './modules/health/health.service';
import { UsersController } from './modules/users/users.controller';
import { UsersRepository } from './modules/users/users.repository';
import { UsersService } from './modules/users/users.service';

export interface ContainerOptions {
  env: Env;
  /** Log `service` field: monitor-api | monitor-worker | migrate | test. */
  service: string;
  logger?: Logger;
}

/** Composition root: every dependency is built here; nothing else constructs infrastructure. */
export interface Container {
  env: Env;
  logger: Logger;
  database: DatabaseHandle;
  db: Database;
  /** Command connection (cache, rate limits, idempotency, tickets, publish). */
  redis: Redis;
  lifecycle: { shuttingDown: boolean };
  passwords: PasswordService;
  tokens: TokenService;
  userCache: UserCache;
  audit: AuditService;
  health: HealthService;
  authController: AuthController;
  usersController: UsersController;
  /** Runs during shutdown before HTTP connections are drained (ends SSE streams). */
  beforeHttpClose?: () => Promise<void>;
  close(): Promise<void>;
}

export const buildContainer = (options: ContainerOptions): Container => {
  const { env } = options;
  const logger =
    options.logger ?? createLogger({ level: env.LOG_LEVEL, appEnv: env.APP_ENV, service: options.service });

  const database = createDatabase(env.DATABASE_URL, logger);
  const { db } = database;
  const redis = createRedis(env.REDIS_URL, 'command', logger);
  const lifecycle = { shuttingDown: false };

  const audit = new AuditService(new AuditRepository(db), logger);
  const users = new UsersRepository(db);
  const refreshTokens = new RefreshTokenRepository(db);
  const passwords = new PasswordService();
  const tokens = new TokenService({
    secret: env.JWT_ACCESS_SECRET,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  });
  const userCache = new UserCache(redis, users, logger);

  const authService = new AuthService({
    db,
    users,
    refreshTokens,
    passwords,
    tokens,
    throttle: new LoginThrottle(redis, logger),
    userCache,
    audit,
    logger,
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  });
  const usersService = new UsersService({ db, users, refreshTokens, passwords, userCache, audit, logger });

  const health = new HealthService({ env, database, redis, isShuttingDown: () => lifecycle.shuttingDown });

  const close = async () => {
    await Promise.allSettled([closeRedis(redis), database.close()]);
  };

  return {
    env,
    logger,
    database,
    db,
    redis,
    lifecycle,
    passwords,
    tokens,
    userCache,
    audit,
    health,
    authController: new AuthController(authService, env),
    usersController: new UsersController(usersService),
    close,
  };
};
