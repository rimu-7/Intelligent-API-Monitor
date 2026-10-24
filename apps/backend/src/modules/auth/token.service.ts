import { isRole, type Role } from '@apimon/shared';
import { errors, jwtVerify, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { UnauthorizedError } from '../../lib/errors';

export interface AccessTokenClaims {
  sub: string;
  role: Role;
  /** users.token_version at issue time. */
  tv: number;
  jti: string;
}

export interface TokenServiceConfig {
  secret: string;
  issuer: string;
  audience: string;
  ttlSeconds: number;
}

/** HS256 access tokens via jose (§12.4, A5). Claims carry no personal data. */
export class TokenService {
  private readonly key: Uint8Array;

  constructor(private readonly config: TokenServiceConfig) {
    this.key = new TextEncoder().encode(config.secret);
  }

  get ttlSeconds(): number {
    return this.config.ttlSeconds;
  }

  async sign(user: { id: string; role: Role; tokenVersion: number }): Promise<string> {
    return new SignJWT({ role: user.role, tv: user.tokenVersion })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.config.ttlSeconds}s`)
      .setJti(randomUUID())
      .sign(this.key);
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
        requiredClaims: ['sub', 'exp', 'iat', 'jti'],
      });
      const { sub, role, tv, jti } = payload;
      if (typeof sub !== 'string' || !isRole(role) || typeof tv !== 'number' || typeof jti !== 'string') {
        throw new UnauthorizedError('Invalid access token');
      }
      return { sub, role, tv, jti };
    } catch (error) {
      if (error instanceof errors.JWTExpired)
        throw new UnauthorizedError('Access token expired', 'TOKEN_EXPIRED');
      if (error instanceof UnauthorizedError) throw error;
      throw new UnauthorizedError('Invalid access token');
    }
  }
}
