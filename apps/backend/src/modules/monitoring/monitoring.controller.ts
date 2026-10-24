import type { Request, Response } from 'express';
import { ok } from '../../http/respond';
import type { MonitoringService } from './monitoring.service';

const contextOf = (req: Request) => ({ principal: req.principal, requestId: req.requestId });

export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  ingest = async (req: Request, res: Response): Promise<void> => {
    ok(res, await this.monitoring.ingest(req.body, { ...contextOf(req), source: 'api' }));
  };

  ingestStatic = async (req: Request, res: Response, file: string): Promise<void> => {
    ok(res, await this.monitoring.ingestStaticFile(file, contextOf(req)));
  };

  listStaticFiles = (_req: Request, res: Response): void => {
    const files = this.monitoring.listStaticFiles();
    ok(
      res,
      files.map((name) => ({ name })),
      { meta: { total: files.length, limit: files.length, offset: 0 } },
    );
  };

  fetchLive = async (req: Request, res: Response, count: number): Promise<void> => {
    ok(res, await this.monitoring.fetchLive(count, contextOf(req)));
  };

  listRuns = async (_req: Request, res: Response, limit: number): Promise<void> => {
    const runs = await this.monitoring.listRuns(limit);
    ok(res, runs, { meta: { total: runs.length, limit, offset: 0 } });
  };
}
