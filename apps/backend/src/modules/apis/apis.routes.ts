import type { SecureRouter } from '../../http/secure-router';
import type { ApisController } from './apis.controller';
import { apiNameParams, updateThresholdsBody } from './apis.schemas';

export const registerApisRoutes = (api: SecureRouter, controller: ApisController): void => {
  api.route({
    method: 'get',
    path: '/apis',
    access: { permission: 'apis:read' },
    handler: (req, res) => controller.list(req, res),
  });

  api.route({
    method: 'patch',
    path: '/apis/:name/thresholds',
    access: { permission: 'apis:configure', userOnly: true },
    schemas: { params: apiNameParams, body: updateThresholdsBody },
    handler: (req, res, { params, body }) => controller.updateThresholds(req, res, params.name, body),
  });
};
