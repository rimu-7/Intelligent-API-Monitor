import type { Request, Response } from 'express';
import { requireUserPrincipal } from '../../http/principal';
import { ok } from '../../http/respond';
import type { ListAlertsInput } from './alerts.schemas';
import type { AlertsService } from './alerts.service';

const contextOf = (req: Request) => ({ ip: req.ip, requestId: req.requestId });

export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  list = async (_req: Request, res: Response, query: ListAlertsInput): Promise<void> => {
    const { items, total } = await this.alerts.list(query);
    ok(res, items, { meta: { total, limit: query.limit, offset: query.offset, status: query.status } });
  };

  summary = async (_req: Request, res: Response): Promise<void> => {
    ok(res, await this.alerts.summary());
  };

  get = async (_req: Request, res: Response, id: string): Promise<void> => {
    ok(res, await this.alerts.get(id));
  };

  resolve = async (req: Request, res: Response, id: string, note: string | undefined): Promise<void> => {
    ok(res, await this.alerts.resolve(id, requireUserPrincipal(req.principal), note, contextOf(req)));
  };

  regenerate = async (req: Request, res: Response, id: string): Promise<void> => {
    ok(res, await this.alerts.regenerate(id, requireUserPrincipal(req.principal), contextOf(req)), {
      status: 202,
    });
  };
}
