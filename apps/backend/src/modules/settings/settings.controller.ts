import type { Request, Response } from 'express';
import { requireUserPrincipal } from '../../http/principal';
import { ok } from '../../http/respond';
import type { TestEmailInput, UpdateNotificationSettingsInput } from './settings.schemas';
import type { SettingsService } from './settings.service';

const contextOf = (req: Request) => ({ ip: req.ip, requestId: req.requestId });

export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  getNotifications = async (_req: Request, res: Response): Promise<void> => {
    ok(res, await this.settings.getNotificationSettings());
  };

  updateNotifications = async (
    req: Request,
    res: Response,
    body: UpdateNotificationSettingsInput,
  ): Promise<void> => {
    ok(
      res,
      await this.settings.updateNotificationSettings(
        body,
        requireUserPrincipal(req.principal),
        contextOf(req),
      ),
    );
  };

  sendTestEmail = async (req: Request, res: Response, body: TestEmailInput): Promise<void> => {
    ok(res, await this.settings.sendTestEmail(body, requireUserPrincipal(req.principal), contextOf(req)));
  };
}
