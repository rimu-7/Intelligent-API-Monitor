import type { SecureRouter } from '../../http/secure-router';
import type { UsersController } from './users.controller';
import { createUserBody, listUsersQuery, updateUserBody, userIdParams } from './users.schemas';

export const registerUsersRoutes = (router: SecureRouter, controller: UsersController): void => {
  router.route({
    method: 'get',
    path: '/users',
    access: { permission: 'users:manage', userOnly: true },
    schemas: { query: listUsersQuery },
    handler: (req, res, { query }) => controller.list(req, res, query),
  });

  router.route({
    method: 'post',
    path: '/users',
    access: { permission: 'users:manage', userOnly: true },
    schemas: { body: createUserBody },
    handler: (req, res, { body }) => controller.create(req, res, body),
  });

  router.route({
    method: 'patch',
    path: '/users/:id',
    access: { permission: 'users:manage', userOnly: true },
    schemas: { params: userIdParams, body: updateUserBody },
    handler: (req, res, { params, body }) => controller.update(req, res, params.id, body),
  });
};
