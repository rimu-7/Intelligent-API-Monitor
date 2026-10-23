import type { RequestHandler } from "express";
import { hasPermission, type Permissions } from "../lib/permissions.js";
import { ApiError } from "../utils/api-error.js";
import { getAuth } from "./authenticate.js";

/** Requires the signed-in user's role to grant every listed permission. */
export const authorize =
  (permissions: Permissions): RequestHandler =>
  (req, _res, next) => {
    const { user } = getAuth(req);
    if (!hasPermission(user.role, permissions)) throw ApiError.forbidden();
    next();
  };
