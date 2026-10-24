import type { Request, Response } from 'express';
import { requireUserPrincipal } from '../../http/principal';
import { ok } from '../../http/respond';
import { toUserDto } from './users.mapper';
import type { CreateUserInput, ListUsersInput, UpdateUserInput } from './users.schemas';
import type { UsersService } from './users.service';

const contextOf = (req: Request) => ({ ip: req.ip, requestId: req.requestId });

export class UsersController {
  constructor(private readonly users: UsersService) {}

  list = async (_req: Request, res: Response, query: ListUsersInput): Promise<void> => {
    const { items, total } = await this.users.list(query);
    ok(res, items.map(toUserDto), { meta: { total, limit: query.limit, offset: query.offset } });
  };

  create = async (req: Request, res: Response, body: CreateUserInput): Promise<void> => {
    const user = await this.users.create(body, requireUserPrincipal(req.principal), contextOf(req));
    ok(res, toUserDto(user), { status: 201 });
  };

  update = async (req: Request, res: Response, id: string, body: UpdateUserInput): Promise<void> => {
    const user = await this.users.update(id, body, requireUserPrincipal(req.principal), contextOf(req));
    ok(res, toUserDto(user));
  };
}
