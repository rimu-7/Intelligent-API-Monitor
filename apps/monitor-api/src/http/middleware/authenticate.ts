import type { RequestHandler } from 'express';
import { safeEqual } from '../../lib/crypto';
import { UnauthorizedError } from '../../lib/errors';
import type { TokenService } from '../../modules/auth/token.service';
import type { UserCache } from '../../modules/auth/user-cache';
import { anonymousPrincipal, ingestKeyPrincipal, userPrincipal } from '../principal';

export interface AuthenticateDeps {
  tokens: TokenService;
  userCache: UserCache;
  ingestApiKey: string;
  demoMode: boolean;
}

const BEARER = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i;

/**
 * Resolves `req.principal` on every request (§12.3):
 * 1. Bearer JWT → verified user (an invalid/expired token is a 401, even in demo mode — never a
 *    silent downgrade to anonymous); the user must still be active with a matching token_version.
 * 2. `x-ingest-key` → service principal (timing-safe compare).
 * 3. otherwise anonymous (DEMO_PERMISSIONS only when DEMO_MODE=true).
 */
export const createAuthenticate = ({
  tokens,
  userCache,
  ingestApiKey,
  demoMode,
}: AuthenticateDeps): RequestHandler => {
  const anonymous = anonymousPrincipal(demoMode);

  return async (req, _res, next) => {
    const authorization = req.header('authorization');
    if (authorization !== undefined) {
      const match = BEARER.exec(authorization.trim());
      if (!match?.[1]) throw new UnauthorizedError('Malformed Authorization header');
      const claims = await tokens.verify(match[1]);
      const user = await userCache.get(claims.sub);
      if (!user || !user.isActive || user.tokenVersion !== claims.tv) {
        throw new UnauthorizedError('Session is no longer valid');
      }
      req.principal = userPrincipal(user);
      return next();
    }

    const ingestKey = req.header('x-ingest-key');
    if (ingestKey !== undefined) {
      if (!safeEqual(ingestKey, ingestApiKey)) throw new UnauthorizedError('Invalid ingest key');
      req.principal = ingestKeyPrincipal();
      return next();
    }

    req.principal = anonymous;
    next();
  };
};
