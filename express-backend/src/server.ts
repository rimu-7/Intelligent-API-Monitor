import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { checkDatabaseConnection, closeDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { logger } from "./lib/logger.js";
import { checkRedisConnection, closeRedis } from "./lib/redis.js";
import { seedAdmin } from "./scripts/seed-admin.js";

// Verify Database Connectivity
try {
  await checkDatabaseConnection();
  logger.info("✅ PostgreSQL database connected successfully");
} catch (error) {
  logger.fatal(`❌ Cannot connect to the database: ${(error as Error).message}`);
  await closeDatabase();
  process.exit(1);
}

// Verify Redis Connectivity
try {
  const latency = await checkRedisConnection();
  logger.info(`✅ Redis connected successfully (ping latency: ${latency}ms)`);
} catch (error) {
  logger.fatal(`❌ Cannot connect to Redis: ${(error as Error).message}`);
  await closeRedis();
  await closeDatabase();
  process.exit(1);
}

// Ensure database schema migrations and initial admin account are ready
try {
  await runMigrations();
  await seedAdmin();
} catch (error) {
  logger.error({ err: (error as Error).message }, "⚠️ Migration or admin seed warning");
}

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 Server running at http://localhost:${env.PORT} (${env.NODE_ENV})`);
  logger.info(`📡 Health endpoint: http://localhost:${env.PORT}/health`);
  logger.info(`🔑 API v1 base URL: http://localhost:${env.PORT}/api/v1`);
});

const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully...`);

  // Force exit if open connections don't close within 10s
  setTimeout(() => process.exit(1), 10_000).unref();

  server.close(async () => {
    try {
      await closeRedis();
      await closeDatabase();
      logger.info("👋 All connections closed. Goodbye!");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during graceful shutdown");
      process.exit(1);
    }
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "Unhandled promise rejection"));
