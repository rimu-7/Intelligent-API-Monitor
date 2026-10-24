import type { Redis } from 'ioredis';
import type { Env } from './config/env';
import { createDatabase, type Database, type DatabaseHandle } from './infrastructure/database/client';
import { createLogger, type Logger } from './infrastructure/logger';
import { createMailer, type Mailer } from './infrastructure/mail/mailer';
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
import { Queues } from './infrastructure/queue/queues';
import { AlertsController } from './modules/alerts/alerts.controller';
import { AlertsRepository } from './modules/alerts/alerts.repository';
import { AlertsService } from './modules/alerts/alerts.service';
import { ApisController } from './modules/apis/apis.controller';
import { ApisRepository } from './modules/apis/apis.repository';
import { ApisService } from './modules/apis/apis.service';
import { HealthService } from './modules/health/health.service';
import { MonitoringController } from './modules/monitoring/monitoring.controller';
import { MonitoringRepository } from './modules/monitoring/monitoring.repository';
import { MonitoringService } from './modules/monitoring/monitoring.service';
import { resolveSamplesDir, StaticSources } from './modules/monitoring/static-sources';
import { ThresholdsService } from './modules/monitoring/thresholds.service';
import { AiCache } from './modules/ai/ai-cache';
import { AlertEnrichmentService } from './modules/ai/alert-enrichment.service';
import type { CircuitBreaker } from './modules/ai/circuit-breaker';
import { createBreakers } from './modules/ai/circuit-registry';
import { createProviders } from './modules/ai/providers';
import type { LlmProvider } from './modules/ai/providers/llm-provider';
import { NotificationsRepository } from './modules/notifications/notifications.repository';
import { NotificationsService } from './modules/notifications/notifications.service';
import { SettingsController } from './modules/settings/settings.controller';
import { SettingsRepository } from './modules/settings/settings.repository';
import { SettingsService } from './modules/settings/settings.service';
import { EventBus } from './modules/realtime/event-bus';
import { SseHub } from './modules/realtime/sse-hub';
import { StreamTickets } from './modules/realtime/stream-tickets';
import { SimulatorClient } from './modules/simulator/simulator.client';
import { UsersController } from './modules/users/users.controller';
import { UsersRepository } from './modules/users/users.repository';
import { UsersService } from './modules/users/users.service';

export interface ContainerOptions {
  env: Env;
  /** Log `service` field: monitor-api | monitor-worker | migrate | test. */
  service: string;
  logger?: Logger;
  /** BullMQ key prefix: "apimon" (default) or "apimon-test". */
  queuePrefix?: string;
  /** Only the API process needs QueueEvents (sync wait for AI text). */
  withAiEvents?: boolean;
  /** Test double for the simulator HTTP client. */
  simulator?: SimulatorClient;
  /** Test doubles for the LLM providers (default: configured providers from env). */
  llmProviders?: LlmProvider[];
  /** Test double for SMTP. */
  mailer?: Mailer;
  /** API processes subscribe to realtime events for SSE; the worker does not. */
  withRealtime?: boolean;
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
  queues: Queues;
  events: EventBus;
  thresholds: ThresholdsService;
  alertsRepository: AlertsRepository;
  alerts: AlertsService;
  monitoring: MonitoringService;
  simulator: SimulatorClient;
  monitoringController: MonitoringController;
  alertsController: AlertsController;
  apisController: ApisController;
  queuePrefix: string;
  providers: readonly LlmProvider[];
  breakers: ReadonlyMap<string, CircuitBreaker>;
  enrichment: AlertEnrichmentService;
  notifications: NotificationsRepository;
  notificationsService: NotificationsService;
  settings: SettingsService;
  settingsController: SettingsController;
  monitoringRepository: MonitoringRepository;
  streamTickets: StreamTickets;
  /** Present when `withRealtime` (API processes). */
  sseHub: SseHub | undefined;
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

  // Monitoring, alerts, APIs.
  const queuePrefix = options.queuePrefix ?? 'apimon';
  const queues = new Queues({
    redisUrl: env.REDIS_URL,
    prefix: queuePrefix,
    logger,
    withAiEvents: options.withAiEvents ?? false,
  });
  const events = new EventBus(redis, logger);
  const apisRepository = new ApisRepository(db);
  const thresholds = new ThresholdsService(
    apisRepository,
    redis,
    { latencyWarningMs: env.LATENCY_WARNING_MS, latencyCriticalMs: env.LATENCY_CRITICAL_MS },
    logger,
  );
  const alertsRepository = new AlertsRepository(db);
  const simulator =
    options.simulator ?? new SimulatorClient(env.SIMULATOR_URL, env.INTERNAL_SERVICE_KEY, logger);
  const staticSources = new StaticSources(resolveSamplesDir(env.SAMPLES_DIR));
  if (staticSources.list().length === 0 && options.service === 'monitor-api') {
    logger.warn(
      { samples_dir: staticSources.directory ?? null },
      'no sample files found; static ingestion is unavailable',
    );
  }
  const monitoringRepository = new MonitoringRepository(db, logger);
  const monitoring = new MonitoringService({
    env,
    repository: monitoringRepository,
    alerts: alertsRepository,
    thresholds,
    queues,
    events,
    staticSources,
    simulator,
    logger,
  });
  const alerts = new AlertsService({ repository: alertsRepository, redis, queues, events, audit, logger });
  const apis = new ApisService({ repository: apisRepository, thresholds, redis, audit, logger });

  // AI enrichment (executed by the worker).
  const providers = options.llmProviders ?? createProviders(env);
  const breakers = createBreakers(providers, redis, logger);
  const enrichment = new AlertEnrichmentService({
    store: alertsRepository,
    thresholds,
    providers,
    breakers,
    cache: new AiCache(redis, env.AI_CACHE_TTL_SECONDS, logger),
    timeoutMs: env.AI_TIMEOUT_MS,
    logger,
  });
  const notifications = new NotificationsRepository(db);
  const mailer = options.mailer ?? createMailer(env);
  const settings = new SettingsService({
    repository: new SettingsRepository(db),
    mailer,
    audit,
    env,
    logger,
  });
  const notificationsService = new NotificationsService({
    repository: notifications,
    alerts: alertsRepository,
    mailer,
    recipients: () => settings.alertRecipients(),
    publicWebUrl: env.PUBLIC_WEB_URL,
    logger,
  });

  // Realtime: single-use SSE tickets; the hub needs its own subscriber connection.
  const streamTickets = new StreamTickets(redis);
  const subscriber = options.withRealtime ? createRedis(env.REDIS_URL, 'subscriber', logger) : undefined;
  const sseHub = subscriber ? new SseHub(subscriber, logger) : undefined;

  const close = async () => {
    await sseHub?.shutdown();
    await queues.close();
    mailer.close();
    await Promise.allSettled([
      closeRedis(redis),
      subscriber ? closeRedis(subscriber) : undefined,
      database.close(),
    ]);
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
    queues,
    events,
    thresholds,
    alertsRepository,
    alerts,
    monitoring,
    simulator,
    monitoringController: new MonitoringController(monitoring),
    alertsController: new AlertsController(alerts),
    apisController: new ApisController(apis),
    queuePrefix,
    providers,
    breakers,
    enrichment,
    notifications,
    notificationsService,
    settings,
    settingsController: new SettingsController(settings),
    monitoringRepository,
    streamTickets,
    sseHub,
    beforeHttpClose: async () => {
      await sseHub?.shutdown();
    },
    close,
  };
};
