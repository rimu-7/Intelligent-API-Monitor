import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { usersController } from "./users.controller.js";

export const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter
  .route("/")
  .post(authorize({ user: ["create", "set-role"] }), usersController.create)
  .get(authorize({ user: ["list"] }), usersController.list);

usersRouter
  .route("/:id")
  .get(authorize({ user: ["get"] }), usersController.getById)
  .delete(authorize({ user: ["delete"] }), usersController.remove);

usersRouter.patch("/:id/role", authorize({ user: ["set-role"] }), usersController.updateRole);
usersRouter.post("/:id/ban", authorize({ user: ["ban"] }), usersController.ban);
usersRouter.post("/:id/unban", authorize({ user: ["ban"] }), usersController.unban);
