import { ROLES } from '@apimon/shared';
import { z } from 'zod';
import { emailSchema, passwordPolicy } from '../auth/auth.schemas';

/** Strict bodies: unknown keys such as `isAdmin` are rejected, never silently accepted (A11). */
export const createUserBody = z.strictObject({
  email: emailSchema,
  password: passwordPolicy,
  /** Required — the creator must choose (§12.6). */
  role: z.enum(ROLES),
});

export const updateUserBody = z
  .strictObject({
    role: z.enum(ROLES).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide role and/or is_active',
  });

export const listUsersQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  role: z.enum(ROLES).optional(),
  is_active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const userIdParams = z.strictObject({ id: z.uuid() });

export type CreateUserInput = z.output<typeof createUserBody>;
export type UpdateUserInput = z.output<typeof updateUserBody>;
export type ListUsersInput = z.output<typeof listUsersQuery>;
