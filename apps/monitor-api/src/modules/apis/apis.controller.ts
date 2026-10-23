import type { Request, Response } from 'express';
import { requireUserPrincipal } from '../../http/principal';
import { ok } from '../../http/respond';
import type { UpdateThresholdsInput } from './apis.schemas';
import type { ApisService } from './apis.service';

export class ApisController {
  constructor(private readonly apis: ApisService) {}

  list = async (_req: Request, res: Response): Promise<void> => {
    const apis = await this.apis.list();
    ok(res, apis, { meta: { total: apis.length, limit: apis.length, offset: 0 } });
  };

  updateThresholds = async (
    req: Request,
    res: Response,
    name: string,
    body: UpdateThresholdsInput,
  ): Promise<void> => {
    ok(
      res,
      await this.apis.updateThresholds(name, body, requireUserPrincipal(req.principal), {
        ip: req.ip,
        requestId: req.requestId,
      }),
    );
  };
}
