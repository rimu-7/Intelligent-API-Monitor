import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDatabase, db } from "./client.js";
import { logger } from "../lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// drizzle migrations directory relative to dist/db or src/db
const migrationsFolder = path.resolve(__dirname, "../../drizzle");

/**
 * Runs Drizzle ORM database migrations programmatically.
 * Safe to execute on every application start or as a standalone script.
 */
export const runMigrations = async (): Promise<void> => {
  try {
    logger.info({ folder: migrationsFolder }, "🔄 Checking and applying database migrations...");
    await migrate(db, { migrationsFolder });
    logger.info("✅ Database migrations applied successfully");
  } catch (error) {
    logger.error({ err: (error as Error).message }, "❌ Database migration failed");
    throw error;
  }
};

// If run directly: tsx src/db/migrate.ts
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations()
    .then(() => {
      console.log("Migration complete!");
    })
    .catch((err) => {
      console.error("Migration error:", err);
      process.exitCode = 1;
    })
    .finally(closeDatabase);
}
