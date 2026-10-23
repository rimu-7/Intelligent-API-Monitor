import { config } from "dotenv";
import { z } from "zod";

// Load from current directory or parent directory (.env / ../.env)
config({ path: [".env", "../.env"], quiet: true });

const commaList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((url) => !url.includes("[YOUR-PASSWORD]"), "DATABASE_URL still contains the [YOUR-PASSWORD] placeholder"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().min(1).default("http://localhost:3001"),
  TRUSTED_ORIGINS: commaList,

  // Redis configuration
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // Initial Admin Seed Credentials
  SEED_ADMIN_USERNAME: z.string().min(3).max(30).default("admin"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("Admin@123456!"),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  SEED_ADMIN_NAME: z.string().default("System Administrator"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
