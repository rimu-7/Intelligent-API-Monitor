import type { AuthSession } from "../lib/auth.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware. */
      auth?: AuthSession;
    }
  }
}

export {};
