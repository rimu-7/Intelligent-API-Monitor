import { fromNodeHeaders } from "better-auth/node";
import type { Request, Response } from "express";
import { getAuth } from "../../middlewares/authenticate.js";
import { sendSuccess } from "../../utils/http-response.js";
import { validate } from "../../utils/validate.js";
import { changePasswordSchema, loginSchema, updateProfileSchema } from "./auth.schema.js";
import { authService } from "./auth.service.js";

/** Copies the session cookie (and bearer token header) set by Better Auth onto the response. */
const forwardAuthHeaders = (res: Response, headers: Headers) => {
  const cookies = headers.getSetCookie();
  if (cookies.length) res.append("Set-Cookie", cookies);

  const token = headers.get("set-auth-token");
  if (token) res.setHeader("set-auth-token", token);
};

export const authController = {
  async login(req: Request, res: Response) {
    const input = validate(loginSchema, req.body);
    const clientIp = (req.ip || req.socket.remoteAddress || "127.0.0.1").replace(/^.*:/, "");

    const { headers, token, user } = await authService.login(input, fromNodeHeaders(req.headers), clientIp);

    forwardAuthHeaders(res, headers);
    sendSuccess(res, { user, token });
  },

  async logout(req: Request, res: Response) {
    const authSession = req.auth;
    const headers = await authService.logout(fromNodeHeaders(req.headers), authSession?.session.token);

    forwardAuthHeaders(res, headers);
    sendSuccess(res, { message: "Logged out successfully" });
  },

  async me(req: Request, res: Response) {
    sendSuccess(res, await authService.me(getAuth(req)));
  },

  async listSessions(req: Request, res: Response) {
    const { user, session } = getAuth(req);
    sendSuccess(res, await authService.listSessions(user, session.id, fromNodeHeaders(req.headers)));
  },

  async revokeSession(req: Request, res: Response) {
    const { user } = getAuth(req);
    const sessionId = String(req.params.id);
    sendSuccess(res, await authService.revokeSession(sessionId, user, fromNodeHeaders(req.headers)));
  },

  async revokeOtherSessions(req: Request, res: Response) {
    const { user, session } = getAuth(req);
    sendSuccess(res, await authService.revokeOtherSessions(user, session.id, fromNodeHeaders(req.headers)));
  },

  async changePassword(req: Request, res: Response) {
    const { user, session } = getAuth(req);
    const input = validate(changePasswordSchema, req.body);
    sendSuccess(res, await authService.changePassword(user, input, fromNodeHeaders(req.headers), session.id));
  },

  async updateProfile(req: Request, res: Response) {
    const { user } = getAuth(req);
    const input = validate(updateProfileSchema, req.body);
    sendSuccess(res, await authService.updateProfile(user.id, input));
  },
};
