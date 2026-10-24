import { z } from 'zod';
import { ok } from '../../http/respond';
import type { SecureRouter } from '../../http/secure-router';
import type { SimulatorClient } from './simulator.client';

const scenarioParams = z.strictObject({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'invalid scenario name'),
});
const streamStartBody = z.strictObject({
  interval_ms: z.number().int().min(500).max(60_000).default(2_000),
  batch_size: z.number().int().min(1).max(100).default(10),
});

/** Proxies to the simulator's control API so RBAC applies (§14); the simulator URL is env-only. */
export const registerSimulatorRoutes = (api: SecureRouter, simulator: SimulatorClient): void => {
  const access = { permission: 'simulator:control' } as const;

  api.route({
    method: 'get',
    path: '/simulator/scenarios',
    access,
    handler: async (_req, res) => ok(res, await simulator.listScenarios()),
  });

  api.route({
    method: 'post',
    path: '/simulator/scenarios/:name',
    access,
    schemas: { params: scenarioParams },
    handler: async (_req, res, { params }) => ok(res, await simulator.runScenario(params.name)),
  });

  api.route({
    method: 'post',
    path: '/simulator/stream/start',
    access,
    schemas: { body: streamStartBody },
    handler: async (_req, res, { body }) => ok(res, await simulator.startStream(body)),
  });

  api.route({
    method: 'post',
    path: '/simulator/stream/stop',
    access,
    handler: async (_req, res) => ok(res, await simulator.stopStream()),
  });

  api.route({
    method: 'get',
    path: '/simulator/stream/status',
    access,
    handler: async (_req, res) => ok(res, await simulator.streamStatus()),
  });
};
