import type { Role } from '@apimon/shared';
import supertest from 'supertest';
import { expect } from 'vitest';
import { users } from '../../src/infrastructure/database/schema';
import type { TestContext } from './test-app';

export const ORIGIN = 'http://localhost:3000';
export const DEFAULT_PASSWORD = 'correct-horse-battery-staple';

let counter = 0;

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: Role;
}

export const createUser = async (
  ctx: TestContext,
  role: Role,
  options: { email?: string; password?: string; isActive?: boolean } = {},
): Promise<TestUser> => {
  counter += 1;
  const email = options.email ?? `${role.toLowerCase()}-${counter}-${Date.now()}@example.com`;
  const password = options.password ?? DEFAULT_PASSWORD;
  const [row] = await ctx.container.db
    .insert(users)
    .values({
      email,
      role,
      passwordHash: await ctx.container.passwords.hash(password),
      isActive: options.isActive ?? true,
    })
    .returning({ id: users.id });
  if (!row) throw new Error('user insert failed');
  return { id: row.id, email, password, role };
};

export interface LoggedIn {
  token: string;
  cookie: string;
  auth: { Authorization: string };
}

/** The raw `apimon_rt=…` pair from a Set-Cookie header list. */
export const refreshCookieOf = (res: supertest.Response): string => {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((value) => value.startsWith('apimon_rt='));
  if (!cookie) throw new Error('no apimon_rt cookie in response');
  return cookie.split(';')[0] ?? '';
};

export const login = async (
  ctx: TestContext,
  user: { email: string; password: string },
): Promise<LoggedIn> => {
  const res = await supertest(ctx.app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const token = res.body.data.access_token as string;
  return { token, cookie: refreshCookieOf(res), auth: { Authorization: `Bearer ${token}` } };
};
