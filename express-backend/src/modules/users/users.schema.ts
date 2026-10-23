import { z } from "zod";
import { ROLES } from "../../lib/permissions.js";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be at most 30 characters")
  .regex(/^[a-zA-Z0-9_.]+$/, "Username may only contain letters, numbers, underscores and dots");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number")
  .regex(/[^a-zA-Z0-9]/, "Password must contain a special character");

export const roleSchema = z.enum(ROLES);

export const createUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  username: usernameSchema,
  email: z.email().trim().toLowerCase(),
  password: passwordSchema,
  role: roleSchema,
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  role: roleSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

export const userIdParamsSchema = z.object({
  id: z.string().trim().min(1).max(64),
});

export const updateRoleSchema = z.object({
  role: roleSchema,
});

export const banUserSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
  /** Omit for a permanent ban. */
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type BanUserInput = z.infer<typeof banUserSchema>;
