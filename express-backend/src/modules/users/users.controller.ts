import { fromNodeHeaders } from "better-auth/node";
import type { Request, Response } from "express";
import { getAuth } from "../../middlewares/authenticate.js";
import { sendSuccess } from "../../utils/http-response.js";
import { validate } from "../../utils/validate.js";
import {
  banUserSchema,
  createUserSchema,
  listUsersQuerySchema,
  updateRoleSchema,
  userIdParamsSchema,
} from "./users.schema.js";
import { usersService } from "./users.service.js";

export const usersController = {
  async create(req: Request, res: Response) {
    const input = validate(createUserSchema, req.body);
    const user = await usersService.create(input, fromNodeHeaders(req.headers));
    sendSuccess(res, user, 201);
  },

  async list(req: Request, res: Response) {
    const query = validate(listUsersQuerySchema, req.query);
    const { items, meta } = await usersService.list(query, getAuth(req).user);
    sendSuccess(res, items, 200, meta);
  },

  async getById(req: Request, res: Response) {
    const { id } = validate(userIdParamsSchema, req.params);
    sendSuccess(res, await usersService.getById(id, getAuth(req).user));
  },

  async updateRole(req: Request, res: Response) {
    const { id } = validate(userIdParamsSchema, req.params);
    const { role } = validate(updateRoleSchema, req.body);
    const user = await usersService.updateRole(id, role, getAuth(req).user, fromNodeHeaders(req.headers));
    sendSuccess(res, user);
  },

  async ban(req: Request, res: Response) {
    const { id } = validate(userIdParamsSchema, req.params);
    const input = validate(banUserSchema, req.body ?? {});
    const user = await usersService.ban(id, input, getAuth(req).user, fromNodeHeaders(req.headers));
    sendSuccess(res, user);
  },

  async unban(req: Request, res: Response) {
    const { id } = validate(userIdParamsSchema, req.params);
    sendSuccess(res, await usersService.unban(id, getAuth(req).user, fromNodeHeaders(req.headers)));
  },

  async remove(req: Request, res: Response) {
    const { id } = validate(userIdParamsSchema, req.params);
    await usersService.remove(id, getAuth(req).user, fromNodeHeaders(req.headers));
    res.status(204).end();
  },
};
