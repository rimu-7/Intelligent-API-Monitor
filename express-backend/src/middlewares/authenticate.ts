import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { auth, type AuthSession } from "../lib/auth.js";
import { blacklistToken, isTokenBlacklisted } from "../lib/redis.js";
import { ApiError } from "../utils/api-error.js";

/**
 * Authenticates the request using Better Auth session cookie or Bearer token.
 * Validates against Redis token blacklist and enforces real-time ban checking.
 */
export const authenticate: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
  // 1. Check Bearer token blacklist in Redis (fast O(1) check)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token && (await isTokenBlacklisted(token))) {
      throw ApiError.unauthorized("Authentication token has been revoked");
    }
  }

  // 2. Fetch session (Better Auth uses Redis secondaryStorage first)
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) throw ApiError.unauthorized();

  // 3. Check if session token itself is blacklisted
  if (session.session.token && (await isTokenBlacklisted(session.session.token))) {
    throw ApiError.unauthorized("Session has been revoked or expired");
  }

  // 4. Real-time ban enforcement
  if (session.user.banned) {
    if (session.session.token) {
      await blacklistToken(session.session.token);
    }
    const reason = session.user.banReason ? `: ${session.user.banReason}` : "";
    throw ApiError.forbidden(`Account has been suspended${reason}. Please contact an administrator.`);
  }

  req.auth = session;
  next();
};

/** Returns the session set by `authenticate`. Use only on authenticated routes. */
export const getAuth = (req: Request): AuthSession => {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth;
};
