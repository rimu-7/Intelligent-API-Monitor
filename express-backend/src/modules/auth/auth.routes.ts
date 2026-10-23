import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { loginRateLimit } from "../../middlewares/rate-limit.js";
import { authController } from "./auth.controller.js";

export const authRouter = Router();

// Public: Login endpoint protected by Redis distributed rate-limiting & account lockout shield
authRouter.post("/login", loginRateLimit, authController.login);

// Protected routes (Session cookie or Authorization: Bearer <token>)
authRouter.post("/logout", authenticate, authController.logout);
authRouter.get("/me", authenticate, authController.me);
authRouter.patch("/profile", authenticate, authController.updateProfile);
authRouter.post("/change-password", authenticate, authController.changePassword);

// Advanced Session Management
authRouter.get("/sessions", authenticate, authController.listSessions);
authRouter.delete("/sessions/:id", authenticate, authController.revokeSession);
authRouter.post("/sessions/revoke-others", authenticate, authController.revokeOtherSessions);
