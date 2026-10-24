import { z } from 'zod';

/** A2: 12–128 characters. The upper bound caps hashing cost (hashing DoS). */
export const passwordPolicy = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters');

/** Trimmed and lowercased before validation; stored that way. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('Must be a valid email address'));

/**
 * Login is deliberately loose (no policy hints) but strict about unknown keys (A11) and bounded
 * so an attacker cannot make us hash megabytes.
 */
export const loginBody = z.strictObject({
  email: z.string().trim().toLowerCase().min(1, 'Email is required').max(254),
  password: z.string().min(1, 'Password is required').max(128),
});

export const changePasswordBody = z
  .strictObject({
    current_password: z.string().min(1, 'Current password is required').max(128),
    new_password: passwordPolicy,
  })
  .refine((body) => body.current_password !== body.new_password, {
    path: ['new_password'],
    message: 'New password must differ from the current password',
  });

export type LoginInput = z.output<typeof loginBody>;
export type ChangePasswordInput = z.output<typeof changePasswordBody>;
