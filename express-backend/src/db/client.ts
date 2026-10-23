import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

const client = postgres(env.DATABASE_URL, {
  prepare: false,
  max: env.DATABASE_POOL_MAX,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle({ client, schema });

export type Database = typeof db;

export const closeDatabase = () => client.end({ timeout: 5 });

/** Fails fast on startup if the database is unreachable or the credentials are wrong. */
export const checkDatabaseConnection = async () => {
  await client`select 1`;
};

/** Healthcheck probe reporting database status and latency in milliseconds */
export const checkDatabaseHealth = async () => {
  const start = Date.now();
  try {
    await client`select 1`;
    return { status: "up", connected: true, latencyMs: Date.now() - start };
  } catch (error) {
    return { status: "down", connected: false, error: (error as Error).message };
  }
};
