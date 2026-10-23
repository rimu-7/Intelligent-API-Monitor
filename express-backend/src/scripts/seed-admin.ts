/**
 * Creates the initial super admin account.
 * Safe to run multiple times (idempotent).
 *
 * Reads values from .env (SEED_ADMIN_*).
 */
import { fileURLToPath } from "node:url";
import { eq, or } from "drizzle-orm";
import { env } from "../config/env.js";
import { closeDatabase, db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { users } from "../db/schema/index.js";
import { auth } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { closeRedis } from "../lib/redis.js";

export const seedAdmin = async (): Promise<void> => {
  // Ensure tables exist before seeding
  await runMigrations();

  const username = env.SEED_ADMIN_USERNAME.toLowerCase().trim();
  const email = env.SEED_ADMIN_EMAIL.toLowerCase().trim();
  const password = env.SEED_ADMIN_PASSWORD;
  const name = env.SEED_ADMIN_NAME.trim();

  logger.info({ username, email }, "🌱 Checking initial admin account...");

  const [existing] = await db
    .select({
      id: users.id,
      role: users.role,
      username: users.username,
      banned: users.banned,
    })
    .from(users)
    .where(or(eq(users.username, username), eq(users.email, email)))
    .limit(1);

  if (existing) {
    if (existing.role !== "admin" || existing.banned) {
      await db
        .update(users)
        .set({
          role: "admin",
          banned: false,
          banReason: null,
          banExpires: null,
        })
        .where(eq(users.id, existing.id));
      logger.info(
        `✅ User "${existing.username}" was promoted to unbanned super admin`,
      );
    } else {
      logger.info(
        `ℹ️  Admin "${existing.username}" is already configured and active`,
      );
    }
    return;
  }

  // Create initial admin using Better Auth trusted internal API
  const { user } = await auth.api.createUser({
    body: {
      name,
      email,
      password,
      role: "admin",
      data: {
        username,
        displayUsername: env.SEED_ADMIN_USERNAME,
        emailVerified: true,
      },
    },
  });

  logger.info(
    `🚀 Super Admin created successfully!\n` +
      `   ┌───────────────────────────────────────────────┐\n` +
      `   │ Admin Username : ${username.padEnd(28)} │\n` +
      `   │ Admin Email    : ${email.padEnd(28)} │\n` +
      `   │ Role           : admin                          │\n` +
      `   │ User ID        : ${user.id.slice(0, 28).padEnd(28)} │\n` +
      `   └───────────────────────────────────────────────┘`,
  );
};

// Execute if run directly from command line
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedAdmin()
    .then(() => {
      console.log("Admin seed completed successfully.");
    })
    .catch((error) => {
      console.error("❌ Seeding failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedis();
      await closeDatabase();
    });
}
