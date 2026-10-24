import { Router, type RequestHandler } from 'express';
import type { MonitorApiClient, PushResult } from '../clients/monitor-api.client';
import type { TelemetryGenerator } from '../generator/telemetry-generator';
import { HttpError } from '../middleware/error-handler';
import { findScenario, SCENARIOS } from '../scenarios/scenarios';

export const scenarioRoutes = (deps: {
  generator: TelemetryGenerator;
  client: Pick<MonitorApiClient, 'push'>;
  auth: RequestHandler;
}): Router =>
  Router()
    .get('/api/scenarios', deps.auth, (_req, res) => {
      res.json({
        success: true,
        data: SCENARIOS.map((scenario) => ({ name: scenario.name, description: scenario.description })),
      });
    })
    .post('/api/scenarios/:name', deps.auth, async (req, res) => {
      const name = String(req.params.name);
      const scenario = findScenario(name);
      if (!scenario) throw new HttpError(404, 'NOT_FOUND', `Unknown scenario "${name}"`);

      const results: (PushResult & { items: number })[] = [];
      for (const batch of scenario.batches(deps.generator)) {
        try {
          results.push({ ...(await deps.client.push(batch, name)), items: batch.length });
        } catch (error) {
          throw new HttpError(
            502,
            'MONITOR_API_UNAVAILABLE',
            error instanceof Error ? error.message : 'push failed',
          );
        }
      }
      res.json({ success: true, data: { scenario: name, batches: results } });
    });
