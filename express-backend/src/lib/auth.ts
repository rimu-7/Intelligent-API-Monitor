import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import { bearer } from "better-auth/plugins/bearer";
import { username } from "better-auth/plugins/username";
import { redisStorage } from "@better-auth/redis-storage";
import { env, isProduction } from "../config/env.js";
import { db } from "../db/client.js";
import * as schema from "../db/schema/index.js";
import { ac, roles } from "./permissions.js";
import { redis } from "./redis.js";

/**
 * Better Auth configured with PostgreSQL via Drizzle ORM and Redis secondary storage
 * for blazing-fast sub-millisecond cached session lookups.
 *
 * Its HTTP handler is NOT mounted publicly; our Express routes call `auth.api.*`
 * directly to maintain strict role-based control and prevent public self-signup.
 */
export const auth = betterAuth({
  appName: "API Monitoring System",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: env.TRUSTED_ORIGINS,

  database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),

  // High-performance Redis secondary storage for sessions and verification tokens
  secondaryStorage: redisStorage({
    client: redis,
    keyPrefix: "ams:auth:",
  }),

  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // accounts are created by admins only
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh expiry once a day
  },

  advanced: {
    useSecureCookies: isProduction,
    cookiePrefix: "ams",
  },

  plugins: [
    username({ minUsernameLength: 3, maxUsernameLength: 30 }),
    admin({ ac, roles, defaultRole: "manager", adminRoles: ["admin"] }),
    bearer(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = AuthSession["user"];
