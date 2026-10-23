import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../../config/env';
import { clientIp } from '../../http/middleware/rate-limit';
import { requireUserPrincipal } from '../../http/principal';
import { ok } from '../../http/respond';
import { permissionList, toAuthUserDto, toUserDto } from '../users/users.mapper';
import type { ChangePasswordInput, LoginInput } from './auth.schemas';
import type { AuthService, IssuedSession, RequestMeta } from './auth.service';

export const REFRESH_COOKIE = 'apimon_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

const metaOf = (req: Request): RequestMeta => ({
  ip: clientIp(req),
  userAgent: req.header('user-agent'),
  requestId: req.requestId,
});

/** HTTP concerns only: cookies, status codes, DTO mapping. */
export class AuthController {
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly auth: AuthService,
    env: Env,
  ) {
    this.cookieOptions = {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: env.COOKIE_SAME_SITE,
      path: REFRESH_COOKIE_PATH,
    };
  }

  private sendSession(res: Response, session: IssuedSession): void {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...this.cookieOptions,
      maxAge: session.refreshExpiresAt.getTime() - Date.now(),
    });
    res.setHeader('Cache-Control', 'no-store');
    ok(res, {
      access_token: session.accessToken,
      token_type: 'Bearer',
      expires_in: session.expiresIn,
      user: toAuthUserDto(session.user),
      permissions: permissionList(session.user.role),
    });
  }

  private clearCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions);
  }

  private refreshCookie(req: Request): string | undefined {
    const value: unknown = req.cookies[REFRESH_COOKIE];
    return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined;
  }

  login = async (req: Request, res: Response, body: LoginInput): Promise<void> => {
    this.sendSession(res, await this.auth.login(body, metaOf(req)));
  };

  refresh = async (req: Request, res: Response): Promise<void> => {
    try {
      this.sendSession(res, await this.auth.refresh(this.refreshCookie(req), metaOf(req)));
    } catch (error) {
      // A dead refresh token should not linger in the browser — except during a tab race,
      // where the cookie already holds the winner's new token.
      if (!(error instanceof Error && 'code' in error && error.code === 'REFRESH_RACE'))
        this.clearCookie(res);
      throw error;
    }
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    const principal = req.principal.kind === 'user' ? req.principal : undefined;
    await this.auth.logout(this.refreshCookie(req), principal, metaOf(req));
    this.clearCookie(res);
    ok(res, { logged_out: true });
  };

  me = async (req: Request, res: Response): Promise<void> => {
    const user = await this.auth.me(requireUserPrincipal(req.principal));
    ok(res, { user: toAuthUserDto(user), permissions: permissionList(user.role), profile: toUserDto(user) });
  };

  changePassword = async (req: Request, res: Response, body: ChangePasswordInput): Promise<void> => {
    this.sendSession(
      res,
      await this.auth.changePassword(requireUserPrincipal(req.principal), body, metaOf(req)),
    );
  };
}
