import compression from "compression";
import cors from "cors";
import express, { type Application } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env, isProduction } from "./config/env.js";
import { checkDatabaseHealth } from "./db/client.js";
import { logger } from "./lib/logger.js";
import { getRedisMetrics } from "./lib/redis.js";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler.js";
import { apiRateLimit } from "./middlewares/rate-limit.js";
import { apiRouter } from "./routes/index.js";

export const createApp = (): Application => {
  const app = express();

  app.disable("x-powered-by");
  if (isProduction) app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.TRUSTED_ORIGINS.length > 0 ? env.TRUSTED_ORIGINS : true,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE"],
      exposedHeaders: ["set-auth-token"],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: "15kb" }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/health" } }));

  // Comprehensive System & Service Health Endpoint
  app.get("/health", async (_req, res) => {
    const [dbHealth, redisHealth] = await Promise.all([
      checkDatabaseHealth(),
      getRedisMetrics(),
    ]);

    const isHealthy = dbHealth.connected && redisHealth.connected;
    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? "healthy" : "degraded",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth,
        redis: redisHealth,
      },
    });
  });

  app.use("/api/v1", apiRateLimit, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
