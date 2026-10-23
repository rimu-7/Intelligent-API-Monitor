import type { Principal } from '../http/principal';

declare global {
  namespace Express {
    interface Request {
      /** Set by `requestContext`. */
      requestId: string;
      /** Set by `authenticate` on every request. */
      principal: Principal;
    }
  }
}

export {};
